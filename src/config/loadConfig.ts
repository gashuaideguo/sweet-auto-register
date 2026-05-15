import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { defaultConfig } from './defaultConfig.js';
import type { AppConfig, FiveSimCountryConfig, HeroSmsCountryConfig } from './types.js';
import { assertValidConfig } from './validateConfig.js';

export const CONFIG_PATH = path.join(process.cwd(), 'config.yaml');

function sortCountriesByOrder<T extends { order: number }>(countries: T[]): T[] {
  return [...countries].sort((left, right) => right.order - left.order);
}

function normalizeHeroSmsCountries(input: Partial<AppConfig>): HeroSmsCountryConfig[] {
  const rawCountries = Array.isArray(input.sms?.heroSms?.countries) ? input.sms.heroSms.countries : defaultConfig.sms.heroSms.countries;
  return sortCountriesByOrder(rawCountries
    .map((country): HeroSmsCountryConfig => ({
      name: String(country?.name ?? country?.browserOptionKey ?? ''),
      browserOptionKey: String(country?.browserOptionKey ?? ''),
      browserDialCode: String(country?.browserDialCode ?? ''),
      order: Number(country?.order ?? 0) || 0,
      providerCountry: Number(country?.providerCountry ?? 0),
      maxPrice: Number(country?.maxPrice ?? defaultConfig.sms.heroSms.countries[0]?.maxPrice ?? 0) || defaultConfig.sms.heroSms.countries[0]?.maxPrice || 0,
    }))
    .filter((country) => Boolean(country.browserOptionKey || country.browserDialCode)));
}

function normalizeFiveSimCountries(input: Partial<AppConfig>): FiveSimCountryConfig[] {
  const rawCountries = Array.isArray(input.sms?.fiveSim?.countries) ? input.sms.fiveSim.countries : defaultConfig.sms.fiveSim.countries;
  return sortCountriesByOrder(rawCountries
    .map((country): FiveSimCountryConfig => ({
      name: String(country?.name ?? country?.browserOptionKey ?? ''),
      browserOptionKey: String(country?.browserOptionKey ?? ''),
      browserDialCode: String(country?.browserDialCode ?? ''),
      order: Number(country?.order ?? 0) || 0,
      providerCountry: String(country?.providerCountry ?? ''),
      providerOperator: String(country?.providerOperator || defaultConfig.sms.fiveSim.countries[0]?.providerOperator || 'any'),
      maxPrice: Number(country?.maxPrice ?? defaultConfig.sms.fiveSim.countries[0]?.maxPrice ?? 0) || 0,
    }))
    .filter((country) => Boolean(country.browserOptionKey || country.browserDialCode || country.providerCountry || country.providerOperator)));
}

const browserProviderTypes = ['real-browser', 'puppeteer', 'puppeteer-extra'] as const;

function isBrowserProviderType(value: unknown): value is AppConfig['browser']['provider'] {
  return browserProviderTypes.includes(value as AppConfig['browser']['provider']);
}

function normalizeSmsProvider(value: unknown): AppConfig['sms']['provider'] {
  const provider = String(value ?? '');
  if (provider === '5sim' || provider === 'five-sim' || provider === 'fivesim') {
    return '5sim';
  }
  if (provider === 'hero-sms') {
    return 'hero-sms';
  }

  return defaultConfig.sms.provider;
}

export function normalizeConfig(input: Partial<AppConfig>): AppConfig {
  return {
    ...defaultConfig,
    ...input,
    browser: {
      provider: isBrowserProviderType(input.browser?.provider) ? input.browser.provider : defaultConfig.browser.provider,
      turnstile: input.browser?.turnstile ?? defaultConfig.browser.turnstile,
      challengeTimeoutMs: Number(input.browser?.challengeTimeoutMs ?? defaultConfig.browser.challengeTimeoutMs) || defaultConfig.browser.challengeTimeoutMs,
      useChrome: input.browser?.useChrome ?? defaultConfig.browser.useChrome,
      chromePath: String(input.browser?.chromePath ?? defaultConfig.browser.chromePath),
      headless: input.browser?.headless ?? defaultConfig.browser.headless,
      keepOpen: input.browser?.keepOpen ?? defaultConfig.browser.keepOpen,
      viewport: {
        width: Number(input.browser?.viewport?.width ?? defaultConfig.browser.viewport.width),
        height: Number(input.browser?.viewport?.height ?? defaultConfig.browser.viewport.height),
      },
      proxy: {
        host: String(input.browser?.proxy?.host ?? defaultConfig.browser.proxy.host),
        port: Number(input.browser?.proxy?.port ?? defaultConfig.browser.proxy.port) || 0,
        username: String(input.browser?.proxy?.username ?? defaultConfig.browser.proxy.username),
        password: String(input.browser?.proxy?.password ?? defaultConfig.browser.proxy.password),
      },
    },
    mail: {
      baseUrl: String(input.mail?.baseUrl ?? defaultConfig.mail.baseUrl),
      adminPassword: String(input.mail?.adminPassword ?? defaultConfig.mail.adminPassword),
      sitePassword: String(input.mail?.sitePassword ?? defaultConfig.mail.sitePassword),
      domain: String(input.mail?.domain ?? defaultConfig.mail.domain),
      pollIntervalMs: Number(input.mail?.pollIntervalMs ?? defaultConfig.mail.pollIntervalMs) || defaultConfig.mail.pollIntervalMs,
      maxAttempts: Number(input.mail?.maxAttempts ?? defaultConfig.mail.maxAttempts) || defaultConfig.mail.maxAttempts,
    },
    sms: {
      provider: normalizeSmsProvider(input.sms?.provider),
      heroSms: {
        apiKey: String(input.sms?.heroSms?.apiKey ?? defaultConfig.sms.heroSms.apiKey),
        service: String(input.sms?.heroSms?.service ?? defaultConfig.sms.heroSms.service),
        countries: normalizeHeroSmsCountries(input),
      },
      fiveSim: {
        apiKey: String(input.sms?.fiveSim?.apiKey ?? defaultConfig.sms.fiveSim.apiKey),
        product: String(input.sms?.fiveSim?.product ?? defaultConfig.sms.fiveSim.product),
        countries: normalizeFiveSimCountries(input),
      },
      pollIntervalMs: Number(input.sms?.pollIntervalMs ?? defaultConfig.sms.pollIntervalMs) || defaultConfig.sms.pollIntervalMs,
      maxAttempts: Number(input.sms?.maxAttempts ?? defaultConfig.sms.maxAttempts) || defaultConfig.sms.maxAttempts,
      numberMaxRetries: Number(input.sms?.numberMaxRetries ?? defaultConfig.sms.numberMaxRetries) || defaultConfig.sms.numberMaxRetries,
    },
    sync: {
      enabled: input.sync?.enabled ?? defaultConfig.sync.enabled,
      host: String(input.sync?.host ?? defaultConfig.sync.host),
      port: Number(input.sync?.port ?? defaultConfig.sync.port) || defaultConfig.sync.port,
      username: String(input.sync?.username ?? defaultConfig.sync.username),
      password: String(input.sync?.password ?? defaultConfig.sync.password),
      remotePath: String(input.sync?.remotePath ?? defaultConfig.sync.remotePath),
    },
    oauth: {
      clientId: String(input.oauth?.clientId ?? defaultConfig.oauth.clientId),
      authorizeUrl: String(input.oauth?.authorizeUrl ?? defaultConfig.oauth.authorizeUrl),
      tokenUrl: String(input.oauth?.tokenUrl ?? defaultConfig.oauth.tokenUrl),
      redirectHost: String(input.oauth?.redirectHost ?? defaultConfig.oauth.redirectHost),
      redirectPort: Number(input.oauth?.redirectPort ?? defaultConfig.oauth.redirectPort) || defaultConfig.oauth.redirectPort,
      redirectPath: String(input.oauth?.redirectPath ?? defaultConfig.oauth.redirectPath),
      scope: String(input.oauth?.scope ?? defaultConfig.oauth.scope),
    },
  };
}

export function readRawConfig(): Partial<AppConfig> {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {};
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return parse(raw) as Partial<AppConfig>;
}

export function loadConfig(): AppConfig {
  return normalizeConfig(readRawConfig());
}

export function saveConfig(input: Partial<AppConfig>): AppConfig {
  const normalized = normalizeConfig(input);
  assertValidConfig(normalized);
  fs.writeFileSync(CONFIG_PATH, stringify(normalized), 'utf8');
  return normalized;
}
