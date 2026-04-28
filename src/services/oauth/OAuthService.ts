import crypto from 'node:crypto';
import type {AppConfig, OAuthConfig} from '../../config/types.js';

export type OAuthCallbackParams = {
    code: string | null;
    state: string | null;
    error: string | null;
    errorDescription: string | null;
};

type RawOAuthTokenResponse = {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    id_token?: string;
    [key: string]: unknown;
};

export type OAuthTokenResponse = {
    access_token: string;
    account_id: string;
    disabled: boolean;
    email: string;
    expired: string;
    id_token: string;
    last_refresh: string;
    refresh_token: string;
    type: 'codex';
};

function isPlaceholder(value: string): boolean {
    return value.includes('YOUR_OAUTH_') || value.includes('your-oauth-domain.example.com');
}

export class OAuthService {
    private codeVerifier = '';
    private codeChallenge = '';
    private state = '';

    constructor(private readonly config: OAuthConfig) {
        this.regeneratePKCE();
    }

    generateCodeVerifier(): string {
        return crypto.randomBytes(32).toString('base64url');
    }

    generateCodeChallenge(verifier: string): string {
        return crypto.createHash('sha256').update(verifier).digest('base64url');
    }

    regeneratePKCE(): void {
        this.codeVerifier = this.generateCodeVerifier();
        this.codeChallenge = this.generateCodeChallenge(this.codeVerifier);
        this.state = crypto.randomBytes(16).toString('hex');
    }

    getRedirectUri(): string {
        return `http://${this.config.redirectHost}:${this.config.redirectPort}${this.config.redirectPath}`;
    }

    getAuthUrl(): string {
        this.ensureConfigured();

        const params = new URLSearchParams({
            client_id: this.config.clientId,
            code_challenge: this.codeChallenge,
            code_challenge_method: 'S256',
            redirect_uri: this.getRedirectUri(),
            response_type: 'code',
            scope: this.config.scope,
            state: this.state,
        });

        return `${this.config.authorizeUrl}?${params.toString()}`;
    }

    extractCallbackParams(callbackUrl: string): OAuthCallbackParams | null {
        try {
            const url = new URL(callbackUrl);
            return {
                code: url.searchParams.get('code'),
                state: url.searchParams.get('state'),
                error: url.searchParams.get('error'),
                errorDescription: url.searchParams.get('error_description'),
            };
        } catch {
            return null;
        }
    }

    async exchangeToken(code: string, preferredEmail?: string): Promise<OAuthTokenResponse> {
        this.ensureConfigured();

        const response = await fetch(this.config.tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: this.getRedirectUri(),
                client_id: this.config.clientId,
                code_verifier: this.codeVerifier,
            }).toString(),
        });

        if (!response.ok) {
            throw new Error(`[OAuth] Token 交换失败：${response.status} ${response.statusText}`);
        }

        const rawTokenResponse = await response.json() as RawOAuthTokenResponse;
        return this.normalizeTokenResponse(rawTokenResponse, preferredEmail);
    }

    static fromAppConfig(config: AppConfig): OAuthService {
        return new OAuthService(config.oauth);
    }

    private normalizeTokenResponse(rawTokenResponse: RawOAuthTokenResponse, preferredEmail?: string): OAuthTokenResponse {
        const now = new Date();
        const expiresInSeconds = Number(rawTokenResponse.expires_in ?? 0);
        const expiredTime = new Date(now.getTime() + Math.max(0, expiresInSeconds) * 1000);
        const accessTokenPayload = this.decodeJwtPayload(rawTokenResponse.access_token);
        const idTokenPayload = this.decodeJwtPayload(rawTokenResponse.id_token);
        const accountId = this.pickFirstString(
            this.readPath(accessTokenPayload, ['https://api.openai.com/auth', 'chatgpt_account_id']),
            this.readPath(idTokenPayload, ['https://api.openai.com/auth', 'chatgpt_account_id']),
            this.readPath(idTokenPayload, ['account_id']),
            this.readPath(accessTokenPayload, ['account_id']),
            this.readPath(idTokenPayload, ['sub']),
            this.readPath(accessTokenPayload, ['sub']),
        );
        const email = this.pickFirstString(
            preferredEmail,
            this.readPath(idTokenPayload, ['email']),
            this.readPath(accessTokenPayload, ['https://api.openai.com/profile', 'email']),
            this.readPath(accessTokenPayload, ['email']),
        );

        return {
            access_token: String(rawTokenResponse.access_token ?? ''),
            account_id: accountId,
            disabled: false,
            email,
            expired: this.formatToOffset8(expiredTime),
            id_token: String(rawTokenResponse.id_token ?? ''),
            last_refresh: this.formatToOffset8(now),
            refresh_token: String(rawTokenResponse.refresh_token ?? ''),
            type: 'codex',
        };
    }

    private decodeJwtPayload(token: unknown): Record<string, unknown> | null {
        if (typeof token !== 'string' || !token) {
            return null;
        }

        const segments = token.split('.');
        if (segments.length < 2) {
            return null;
        }

        try {
            const payload = segments[1]
                .replace(/-/g, '+')
                .replace(/_/g, '/');
            const padding = '='.repeat((4 - payload.length % 4) % 4);
            const decoded = Buffer.from(`${payload}${padding}`, 'base64').toString('utf8');
            const parsed = JSON.parse(decoded);
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
        } catch {
            return null;
        }
    }

    private readPath(value: unknown, path: string[]): string {
        let current = value;
        for (const segment of path) {
            if (!current || typeof current !== 'object' || !(segment in current)) {
                return '';
            }
            current = (current as Record<string, unknown>)[segment];
        }

        return typeof current === 'string' ? current : '';
    }

    private pickFirstString(...values: Array<string | undefined>): string {
        for (const value of values) {
            if (typeof value === 'string' && value.trim()) {
                return value;
            }
        }

        return '';
    }

    private formatToOffset8(date: Date): string {
        const offsetMs = 8 * 60 * 60 * 1000;
        return new Date(date.getTime() + offsetMs).toISOString().replace(/\.[0-9]{3}Z$/, '+08:00');
    }

    private ensureConfigured(): void {
        if (
            !this.config.clientId ||
            !this.config.authorizeUrl ||
            !this.config.tokenUrl ||
            isPlaceholder(this.config.clientId) ||
            isPlaceholder(this.config.authorizeUrl) ||
            isPlaceholder(this.config.tokenUrl)
        ) {
            throw new Error('[OAuth] OAuth 配置仍为占位值，请先在 config.json 中填写 oauth.clientId/oauth.authorizeUrl/oauth.tokenUrl。');
        }
    }
}

