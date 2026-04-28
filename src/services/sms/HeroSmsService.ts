import type {SmsConfig, HeroSmsCountryConfig} from '../../config/types.js';
import type {PhoneProvider} from '../contracts/PhoneProvider.js';
import type {SmsService} from './SmsService.js';
import type {SmsActivation, SmsStatusResult} from './types.js';
import {logger} from '../../shared/logger.js';
import {sleep} from '../../shared/sleep.js';

export class HeroSmsService implements SmsService, PhoneProvider {
    private readonly baseUrl = 'https://hero-sms.com/stubs/handler_api.php';
    private activationId: number | null = null;
    private phoneNumber: string | null = null;
    private activationCost: number | string | undefined;

    constructor(
        private readonly config: SmsConfig,
        private readonly country: HeroSmsCountryConfig,
    ) {
    }

    restoreActivation(activation: SmsActivation): void {
        this.activationId = activation.activationId;
        this.phoneNumber = activation.phoneNumber;
        this.activationCost = activation.activationCost;
    }

    getActivation(): SmsActivation | null {
        if (!this.activationId || !this.phoneNumber) {
            return null;
        }

        const phoneNumber = this.phoneNumber;
        const activationId = this.activationId;

        return {
            activationId,
            phoneNumber,
            activationCost: this.activationCost,
        };
    }

    async getPhoneNumber(): Promise<string> {
        if (this.phoneNumber) {
            logger.info(`[短信服务] 复用当前手机号：${this.phoneNumber}`);
            return this.phoneNumber;
        }

        for (let attempt = 1; attempt <= this.config.numberMaxRetries; attempt += 1) {
            logger.info(`[短信服务] 正在申请手机号。attempt=${attempt}/${this.config.numberMaxRetries}`);
            let data: unknown;
            try {
                data = await this.request('getNumberV2', {
                    service: this.config.heroSms.service,
                    country: this.country.providerCountry,
                    fixedPrice: true,
                    maxPrice: this.country.maxPrice,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`[短信服务] 申请手机号失败：${message}`);
                if (attempt >= this.config.numberMaxRetries) {
                    throw new Error(`HeroSMS API unavailable: ${message}`);
                }
                await sleep(5000);
                continue;
            }

            if (typeof data === 'string') {
                if (data === 'NO_BALANCE') throw new Error('HeroSMS balance is insufficient');
                if (data === 'BAD_KEY') throw new Error('HeroSMS API key is invalid');
                if (data === 'NO_NUMBERS') {
                    logger.warn(`[短信服务] 暂无可用手机号。attempt=${attempt}/${this.config.numberMaxRetries}`);
                    if (attempt >= this.config.numberMaxRetries) {
                        throw new Error('No phone numbers available');
                    }
                    await sleep(3000);
                    continue;
                }
                throw new Error(`Failed to get phone number: ${data}`);
            }

            const activation = this.parseActivation(data);
            this.restoreActivation(activation);
            logger.info(`[短信服务] 已获取手机号：${this.phoneNumber} activation=${this.activationId}`);
            return activation.phoneNumber;
        }

        throw new Error('No phone numbers available');
    }

    async markReady(): Promise<void> {
        const activationId = this.requireActivationId();
        await this.request('setStatus', {id: activationId, status: 3});
        logger.info(`[短信服务] 已将激活记录标记为就绪。activation=${activationId}`);
    }

    async getStatus(): Promise<SmsStatusResult> {
        const data = await this.request('getStatusV2', {id: this.requireActivationId()});

        if (typeof data === 'string') {
            if (data === 'STATUS_WAIT_CODE') return {received: false};
            if (data === 'STATUS_CANCEL') throw new Error('SMS activation was cancelled');
            if (data.startsWith('STATUS_OK:')) {
                return {received: true, code: data.split(':')[1]};
            }
            return {received: false};
        }

        const sms = (data as { sms?: { code?: string } | Array<{ code?: string }> }).sms;
        if (Array.isArray(sms)) {
            const code = sms.find((item) => item?.code)?.code;
            return code ? {received: true, code} : {received: false};
        }
        if (sms?.code) {
            return {received: true, code: sms.code};
        }
        return {received: false};
    }

    async complete(): Promise<void> {
        const activationId = this.requireActivationId();
        await this.request('setStatus', {id: activationId, status: 6});
        logger.info(`[短信服务] 已完成激活记录。activation=${activationId}`);
    }

    async cancel(): Promise<void> {
        if (!this.activationId) {
            return;
        }
        await this.request('setStatus', {id: this.activationId, status: 8});
        logger.info(`[短信服务] 已取消激活记录。activation=${this.activationId}`);
        this.activationId = null;
        this.phoneNumber = null;
        this.activationCost = undefined;
    }

    private requireActivationId(): number {
        if (!this.activationId) {
            throw new Error('SMS activation is missing');
        }
        return this.activationId;
    }

    private parseActivation(payload: unknown): SmsActivation {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid HeroSMS activation payload');
        }

        const data = payload as Record<string, unknown>;
        const activationId = Number(data.activationId);
        const rawPhoneNumber = String(data.phoneNumber ?? '');
        const phoneNumber = rawPhoneNumber.startsWith('+') ? rawPhoneNumber : `+${rawPhoneNumber}`;

        if (!Number.isFinite(activationId) || !phoneNumber || phoneNumber === '+') {
            throw new Error('Invalid HeroSMS activation payload');
        }

        return {
            activationId,
            phoneNumber,
            activationCost: data.activationCost as number | string | undefined,
        };
    }

    private async request(action: string, params: Record<string, string | number | boolean>): Promise<unknown> {
        const url = new URL(this.baseUrl);
        url.searchParams.set('api_key', this.config.heroSms.apiKey);
        url.searchParams.set('action', action);
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

        const maxRequestRetries = 3;
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= maxRequestRetries; attempt += 1) {
            try {
                const response = await fetch(url.toString(), {
                    method: 'GET',
                    headers: {Accept: 'application/json, text/plain;q=0.9, */*;q=0.8'},
                });

                if (!response.ok) {
                    throw new Error(`HeroSMS request failed: ${response.status} ${response.statusText}`);
                }

                const text = await response.text();
                try {
                    return JSON.parse(text);
                } catch {
                    return text.trim();
                }
            } catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error);
                if (attempt >= maxRequestRetries) {
                    break;
                }
                logger.warn(`[短信服务] HeroSMS 请求失败，准备重试。action=${action} attempt=${attempt}/${maxRequestRetries} error=${message}`);
                await sleep(1000 * attempt);
            }
        }

        throw lastError instanceof Error ? lastError : new Error('HeroSMS request failed after retries');
    }
}
