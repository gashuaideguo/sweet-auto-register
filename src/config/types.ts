export type ViewportConfig = {
  width: number;
  height: number;
};

export type BrowserProxyConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
};

export type BrowserProviderType = 'puppeteer' | 'real-browser' | 'puppeteer-extra';

export type BrowserConfig = {
  provider: BrowserProviderType;
  turnstile: boolean;
  challengeTimeoutMs: number;
  useChrome: boolean;
  chromePath: string;
  headless: boolean;
  keepOpen: boolean;
  viewport: ViewportConfig;
  proxy: BrowserProxyConfig;
};

export type MailConfig = {
  baseUrl: string;
  adminPassword: string;
  sitePassword: string;
  domain: string;
  pollIntervalMs: number;
  maxAttempts: number;
};

export type SmsProviderType = 'hero-sms' | '5sim';

export type SmsCountryConfig = {
  name: string;
  browserOptionKey: string;
  browserDialCode: string;
  order: number;
};

export type HeroSmsCountryConfig = SmsCountryConfig & {
  providerCountry: number;
  maxPrice: number;
};

export type FiveSimCountryConfig = SmsCountryConfig & {
  providerCountry: string;
  providerOperator: string;
};

export type HeroSmsProviderConfig = {
  apiKey: string;
  service: string;
  countries: HeroSmsCountryConfig[];
};

export type FiveSimProviderConfig = {
  apiKey: string;
  product: string;
  countries: FiveSimCountryConfig[];
};

export type SmsConfig = {
  provider: SmsProviderType;
  heroSms: HeroSmsProviderConfig;
  fiveSim: FiveSimProviderConfig;
  pollIntervalMs: number;
  maxAttempts: number;
  numberMaxRetries: number;
};

export type SyncConfig = {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
};

export type OAuthConfig = {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectHost: string;
  redirectPort: number;
  redirectPath: string;
  scope: string;
};

export type AppConfig = {
  browser: BrowserConfig;
  startUrl: string;
  mail: MailConfig;
  sms: SmsConfig;
  sync: SyncConfig;
  oauth: OAuthConfig;
};
