import type {MailService} from './MailService.js';
import type {CreateAddressResult, MailMessage, MailSession} from './types.js';
import type {MailConfig} from '../../config/types.js';

export class HttpMailService implements MailService {

    private jwt: string | null = null;

    constructor(private readonly config: MailConfig) {
    }

    async createAddress(name: string | null = null): Promise<CreateAddressResult> {
        const emailName = name || this.randomName();
        const response = await this.requestJson(`${this.config.baseUrl}/admin/new_address`, {
            method: 'POST',
            headers: this.adminHeaders(),
            body: JSON.stringify({name: emailName, domain: this.config.domain, enablePrefix: false}),
        });

        const result = {
            jwt: String(response.jwt),
            address: String(response.address),
            addressId: response.address_id as number | string | null,
        };

        this.useSession(result);
        return result;
    }

    useSession(session: MailSession): void {
        if (!session.address || !session.jwt) {
            throw new Error('Incomplete mail session');
        }
        this.jwt = session.jwt;
    }

    async listMails(limit = 50, offset = 0): Promise<MailMessage[]> {
        if (!this.jwt) {
            throw new Error('Mail session jwt is missing');
        }
        const url = new URL(`${this.config.baseUrl}/api/mails`);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('offset', String(offset));
        const response = await this.requestJson(url.toString(), {
            method: 'GET',
            headers: this.addressHeaders(),
        });
        return this.extractMailsFromPayload(response);
    }

    private adminHeaders(): HeadersInit {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-admin-auth': this.config.adminPassword,
        };
        if (this.config.sitePassword) {
            headers['x-custom-auth'] = this.config.sitePassword;
        }
        return headers;
    }

    private addressHeaders(): HeadersInit {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.jwt}`,
        };
        if (this.config.sitePassword) {
            headers['x-custom-auth'] = this.config.sitePassword;
        }
        return headers;
    }

    private extractMailsFromPayload(payload: unknown): MailMessage[] {
        if (Array.isArray(payload)) return payload as MailMessage[];
        if (payload && typeof payload === 'object') {
            const data = payload as Record<string, unknown>;
            if (Array.isArray(data.results)) return data.results as MailMessage[];
            if (Array.isArray(data.mails)) return data.mails as MailMessage[];
            if (data.data && typeof data.data === 'object') {
                const nested = data.data as Record<string, unknown>;
                if (Array.isArray(nested.results)) return nested.results as MailMessage[];
                if (Array.isArray(nested.mails)) return nested.mails as MailMessage[];
                if (Array.isArray(data.data)) return data.data as MailMessage[];
            }
        }
        return [];
    }

    private randomName(): string {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const length = 8 + Math.floor(Math.random() * 5);
        let name = '';
        for (let index = 0; index < length; index += 1) {
            name += chars[Math.floor(Math.random() * chars.length)];
        }
        return name;
    }

    private async requestJson(url: string, init: RequestInit): Promise<any> {
        const response = await fetch(url, init);
        if (!response.ok) {
            throw new Error(`Mail request failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
}
