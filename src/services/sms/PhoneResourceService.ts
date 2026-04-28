import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../shared/logger.js';
import { SmsVerificationCodeProvider } from '../verification/SmsVerificationCodeProvider.js';
import type { SmsService } from './SmsService.js';
import type { PersistedPhoneState } from './types.js';
import type { SmsCountryConfig, SmsProviderType } from '../../config/types.js';

export class PhoneResourceService {
  private readonly stateFilePath: string;

  constructor(
    private readonly smsServices: Array<{ provider: SmsProviderType; country: SmsCountryConfig; smsService: SmsService }>,
    private readonly options: {
      provider: SmsProviderType;
      maxUses: number;
      pollIntervalMs: number;
      maxAttempts: number;
    },
  ) {
    this.stateFilePath = path.join(process.cwd(), 'auth', 'phone', 'current.json');
  }

  async acquirePhone(): Promise<PersistedPhoneState> {
    const state = this.readState();
    if (state?.phoneNumber) {
      const matchingService = this.findMatchingService(state.provider, state.countryConfig);
      if (matchingService && state.useCount < this.options.maxUses) {
        matchingService.smsService.restoreActivation(state);
        logger.info(`[授权] 正在复用手机号：${state.phoneNumber} useCount=${state.useCount}/${this.options.maxUses}`);
        return state;
      }

      if (!matchingService) {
        logger.info(`[授权] 当前手机号供应商或国家配置不匹配，准备重新申请。provider=${state.provider}`);
      } else {
        logger.info(`[授权] 当前手机号已达到使用上限，准备重新申请。phone=${state.phoneNumber} useCount=${state.useCount}`);
      }
      await this.cancelCurrentPhone();
    }

    return await this.allocateNewPhone();
  }

  async replacePhone(): Promise<PersistedPhoneState> {
    await this.cancelCurrentPhone();
    return await this.allocateNewPhone();
  }

  async markReady(): Promise<void> {
    await this.requireActiveService().smsService.markReady();
  }

  async getVerificationCode(): Promise<string> {
    const activeService = this.requireActiveService();
    await activeService.smsService.markReady();

    const provider = new SmsVerificationCodeProvider(activeService.smsService, {
      intervalMs: this.options.pollIntervalMs,
      maxAttempts: this.options.maxAttempts,
      isCodeSeen: (code) => this.isVerificationCodeSeen(code),
      onCodeAccepted: (code) => this.rememberVerificationCode(code),
    });
    return await provider.getVerificationCode();
  }

  async markVerificationSucceeded(): Promise<void> {
    const state = this.requireState();
    const nextState: PersistedPhoneState = {
      ...state,
      useCount: state.useCount + 1,
      updatedAt: new Date().toISOString(),
    };
    this.writeState(nextState);
    logger.info(`[授权] 已更新手机号使用次数。phone=${nextState.phoneNumber} useCount=${nextState.useCount}/${this.options.maxUses}`);
  }

  async cancelCurrentPhone(): Promise<void> {
    const state = this.readState();
    const activeService = state ? this.findMatchingService(state.provider, state.countryConfig) : null;
    if (state && activeService) {
      activeService.smsService.restoreActivation(state);
    }

    try {
      await activeService?.smsService.cancel();
    } finally {
      this.clearState();
    }
  }

  private async allocateNewPhone(): Promise<PersistedPhoneState> {
    let lastError: unknown = null;

    for (const candidate of this.smsServices) {
      try {
        const phoneNumber = await candidate.smsService.getPhoneNumber();
        const activation = candidate.smsService.getActivation();
        if (!activation) {
          throw new Error('SMS activation is missing after phone allocation');
        }

        const state: PersistedPhoneState = {
          provider: candidate.provider,
          activationId: activation.activationId,
          activationCost: activation.activationCost,
          phoneNumber,
          useCount: 0,
          countryCode: candidate.country.browserDialCode,
          countryConfig: candidate.country,
          seenVerificationCodes: [],
          updatedAt: new Date().toISOString(),
        };

        this.writeState(state);
        logger.info(`[授权] 已持久化手机号状态：${state.phoneNumber}`);
        return state;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[授权] 当前国家申请手机号失败，准备尝试下一个国家。country=${candidate.country.browserOptionKey} error=${message}`);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('No phone numbers available');
  }

  private async isVerificationCodeSeen(code: string): Promise<boolean> {
    const state = this.requireState();
    return state.seenVerificationCodes.includes(code);
  }

  private async rememberVerificationCode(code: string): Promise<void> {
    const state = this.requireState();
    if (state.seenVerificationCodes.includes(code)) {
      return;
    }

    const nextState: PersistedPhoneState = {
      ...state,
      seenVerificationCodes: [...state.seenVerificationCodes, code],
      updatedAt: new Date().toISOString(),
    };
    this.writeState(nextState);
    logger.info(`[授权] 已记录短信验证码。phone=${nextState.phoneNumber} code=${code}`);
  }

  private requireState(): PersistedPhoneState {
    const state = this.readState();
    if (!state) {
      throw new Error('Phone state is missing');
    }
    return state;
  }

  private requireActiveService(): { provider: SmsProviderType; country: SmsCountryConfig; smsService: SmsService } {
    const state = this.requireState();
    const activeService = this.findMatchingService(state.provider, state.countryConfig);
    if (!activeService) {
      throw new Error('SMS service is missing for current phone state');
    }
    activeService.smsService.restoreActivation(state);
    return activeService;
  }

  private findMatchingService(provider: SmsProviderType | string, country: SmsCountryConfig): { provider: SmsProviderType; country: SmsCountryConfig; smsService: SmsService } | null {
    return this.smsServices.find((candidate) => {
      return candidate.provider === provider
        && candidate.country.browserOptionKey === country.browserOptionKey
        && candidate.country.browserDialCode === country.browserDialCode;
    }) ?? null;
  }

  private readState(): PersistedPhoneState | null {
    if (!fs.existsSync(this.stateFilePath)) {
      return null;
    }

    const raw = fs.readFileSync(this.stateFilePath, 'utf8').trim();
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedPhoneState>;
    if (!parsed.phoneNumber || !parsed.activationId) {
      return null;
    }

    const rawCountryConfig = parsed.countryConfig;
    const countryConfig: SmsCountryConfig = {
      browserOptionKey: String(rawCountryConfig?.browserOptionKey ?? ''),
      browserDialCode: String(rawCountryConfig?.browserDialCode ?? parsed.countryCode ?? ''),
    };

    return {
      provider: String(parsed.provider ?? ''),
      activationId: Number(parsed.activationId),
      activationCost: parsed.activationCost,
      phoneNumber: String(parsed.phoneNumber),
      useCount: Number(parsed.useCount ?? 0),
      countryCode: String(parsed.countryCode ?? countryConfig.browserDialCode),
      countryConfig,
      seenVerificationCodes: Array.isArray(parsed.seenVerificationCodes)
        ? parsed.seenVerificationCodes.filter((item): item is string => typeof item === 'string')
        : [],
      updatedAt: String(parsed.updatedAt ?? ''),
    };
  }

  private writeState(state: PersistedPhoneState): void {
    fs.mkdirSync(path.dirname(this.stateFilePath), { recursive: true });
    fs.writeFileSync(this.stateFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  private clearState(): void {
    if (fs.existsSync(this.stateFilePath)) {
      fs.unlinkSync(this.stateFilePath);
    }
  }
}
