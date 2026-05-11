import type {AppConfig} from './types.js';

export const defaultConfig: AppConfig = {
    browser: {
        provider: 'real-browser',
        turnstile: false,
        challengeTimeoutMs: 60000,
        useChrome: true,
        chromePath: '',
        headless: false,
        keepOpen: true,
        viewport: {
            width: 1280,
            height: 900,
        },
        proxy: {
            host: '',
            port: 0,
            username: '',
            password: '',
        },
    },
    startUrl: 'https://example.com',
    mail: {
        baseUrl: '',
        adminPassword: '',
        sitePassword: '',
        domain: '',
        pollIntervalMs: 5000,
        maxAttempts: 30,
    },
    sms: {
        provider: 'hero-sms',
        heroSms: {
            apiKey: '',
            service: 'dr',
            countries: [
                {
                    name: 'Thailand',
                    browserOptionKey: 'TH',
                    browserDialCode: '+66',
                    order: 0,
                    providerCountry: 16,
                    maxPrice: 0.067,
                },
            ],
        },
        fiveSim: {
            apiKey: '',
            product: '',
            countries: [
                {
                    name: 'Thailand',
                    browserOptionKey: 'TH',
                    browserDialCode: '+66',
                    order: 0,
                    providerCountry: 'any',
                    providerOperator: 'any',
                    maxPrice: 0,
                },
            ],
        },
        pollIntervalMs: 5000,
        maxAttempts: 60,
        numberMaxRetries: 5,
    },
    sync: {
        enabled: false,
        host: '',
        port: 22,
        username: '',
        password: '',
        remotePath: '',
    },
    oauth: {
        clientId: 'YOUR_OAUTH_CLIENT_ID',
        authorizeUrl: 'https://your-oauth-domain.example.com/oauth/authorize',
        tokenUrl: 'https://your-oauth-domain.example.com/oauth/token',
        redirectHost: '127.0.0.1',
        redirectPort: 1455,
        redirectPath: '/auth/callback',
        scope: 'openid profile email offline_access',
    },
};
