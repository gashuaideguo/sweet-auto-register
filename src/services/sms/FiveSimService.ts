import type {SmsConfig, FiveSimCountryConfig} from '../../config/types.js';
import type {PhoneProvider} from '../contracts/PhoneProvider.js';
import type {SmsService} from './SmsService.js';
import type {SmsActivation, SmsStatusResult} from './types.js';
import {logger} from '../../shared/logger.js';

export class FiveSimService implements SmsService, PhoneProvider {
    private readonly baseUrl = 'https://5sim.net/v1';
    private activationId: number | null = null;
    private phoneNumber: string | null = null;

    constructor(
        private readonly config: SmsConfig,
        private readonly country: FiveSimCountryConfig,
    ) {
    }

    restoreActivation(activation: SmsActivation): void {
        this.activationId = activation.activationId;
        this.phoneNumber = activation.phoneNumber;
    }

    getActivation(): SmsActivation | null {
        if (!this.activationId || !this.phoneNumber) {
            return null;
        }

        return {
            activationId: this.activationId,
            phoneNumber: this.phoneNumber,
        };
    }

    async getPhoneNumber(): Promise<string> {
        if (this.phoneNumber) {
            logger.info(`[短信服务] 复用当前手机号：${this.phoneNumber}`);
            return this.phoneNumber;
        }

        const data = await this.request(`user/buy/activation/${encodeURIComponent(this.country.providerCountry)}/${encodeURIComponent(this.country.providerOperator)}/${encodeURIComponent(this.config.fiveSim.product)}`);
        const activation = this.parseActivation(data);
        this.restoreActivation(activation);
        logger.info(`[短信服务] 已获取手机号：${this.phoneNumber} activation=${this.activationId}`);
        return activation.phoneNumber;
    }

    async markReady(): Promise<void> {
        logger.info('[短信服务] 5sim 无需显式标记激活记录为就绪。');
    }

    async getStatus(): Promise<SmsStatusResult> {
        const data = await this.request(`user/check/${this.requireActivationId()}`) as {
            status?: string;
            sms?: Array<{ code?: string }>;
        };

        const status = String(data.status ?? '').toUpperCase();
        if (status === 'PENDING') {
            return {received: false};
        }
        if (status === 'CANCELED' || status === 'TIMEOUT' || status === 'BANNED') {
            throw new Error(`5sim order is ${status.toLowerCase()}`);
        }

        const code = Array.isArray(data.sms)
            ? data.sms.find((item) => typeof item?.code === 'string' && item.code.trim())?.code?.trim()
            : '';
        if (status === 'RECEIVED' && code) {
            return {received: true, code};
        }

        return {received: false};
    }

    async complete(): Promise<void> {
        if (!this.activationId) {
            return;
        }
        await this.request(`user/finish/${this.activationId}`);
        logger.info(`[短信服务] 已完成激活记录。activation=${this.activationId}`);
    }

    async cancel(): Promise<void> {
        if (!this.activationId) {
            return;
        }
        await this.request(`user/cancel/${this.activationId}`);
        logger.info(`[短信服务] 已取消激活记录。activation=${this.activationId}`);
        this.activationId = null;
        this.phoneNumber = null;
    }

    private requireActivationId(): number {
        if (!this.activationId) {
            throw new Error('SMS activation is missing');
        }
        return this.activationId;
    }

    private parseActivation(payload: unknown): SmsActivation {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid 5sim activation payload');
        }

        const data = payload as Record<string, unknown>;
        const activationId = Number(data.id);
        const rawPhoneNumber = String(data.phone ?? '');
        const phoneNumber = rawPhoneNumber.startsWith('+') ? rawPhoneNumber : `+${rawPhoneNumber}`;

        if (!Number.isFinite(activationId) || !phoneNumber || phoneNumber === '+') {
            throw new Error('Invalid 5sim activation payload');
        }

        return {
            activationId,
            phoneNumber,
        };
    }

    private async request(path: string): Promise<unknown> {
        const response = await fetch(`${this.baseUrl}/${path}`, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${this.config.fiveSim.apiKey}`,
            },
        });
        if (!response.ok) {
            throw new Error(`5sim request failed: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    }
}
