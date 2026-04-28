import type { VerificationCodeProvider } from '../contracts/VerificationCodeProvider.js';
import type { SmsService } from '../sms/SmsService.js';
import { logger } from '../../shared/logger.js';
import { sleep } from '../../shared/sleep.js';

export class SmsVerificationCodeProvider implements VerificationCodeProvider {
  constructor(
    private readonly smsService: SmsService,
    private readonly options: {
      intervalMs: number;
      maxAttempts: number;
      isCodeSeen?: (code: string) => Promise<boolean> | boolean;
      onCodeAccepted?: (code: string) => Promise<void> | void;
    },
  ) {}

  async getVerificationCode(): Promise<string> {
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      logger.info(`[短信验证码] 正在轮询当前激活记录。attempt=${attempt}/${this.options.maxAttempts}`);

      try {
        const result = await this.smsService.getStatus();
        if (result.received && result.code) {
          const isSeen = await this.options.isCodeSeen?.(result.code);
          if (isSeen) {
            logger.warn(`[短信验证码] 当前验证码已存在，继续轮询。code=${result.code}`);
            await sleep(this.options.intervalMs);
            continue;
          }

          await this.options.onCodeAccepted?.(result.code);
          logger.info(`[短信验证码] 已获取验证码：${result.code}`);
          return result.code;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[短信验证码] 查询当前激活记录失败：${message}`);
      }

      await sleep(this.options.intervalMs);
    }

    throw new Error('SMS verification code timeout for current-activation');
  }
}
