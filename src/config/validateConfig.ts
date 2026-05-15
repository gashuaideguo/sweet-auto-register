import type { AppConfig, BrowserProviderType, SmsProviderType } from './types.js';

const browserProviders: BrowserProviderType[] = ['real-browser', 'puppeteer', 'puppeteer-extra'];
const smsProviders: SmsProviderType[] = ['hero-sms', '5sim'];

export class ConfigValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join('\n'));
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function addPositiveNumberError(errors: string[], path: string, value: unknown): void {
  if (!isFiniteNumber(value) || value <= 0) {
    errors.push(`${path} 必须是大于 0 的数字`);
  }
}

function addNonNegativeNumberError(errors: string[], path: string, value: unknown): void {
  if (!isFiniteNumber(value) || value < 0) {
    errors.push(`${path} 必须是大于等于 0 的数字`);
  }
}

function addIntegerError(errors: string[], path: string, value: unknown): void {
  if (!Number.isInteger(value)) {
    errors.push(`${path} 必须是整数`);
  }
}

function addBooleanError(errors: string[], path: string, value: unknown): void {
  if (!isBoolean(value)) {
    errors.push(`${path} 必须是 true 或 false`);
  }
}

function addRequiredStringError(errors: string[], path: string, value: string): void {
  if (value.trim().length === 0) {
    errors.push(`${path} 不能为空`);
  }
}

export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];

  if (!browserProviders.includes(config.browser.provider)) {
    errors.push('browser.provider 必须是 real-browser、puppeteer 或 puppeteer-extra');
  }

  addBooleanError(errors, 'browser.turnstile', config.browser.turnstile);
  addBooleanError(errors, 'browser.useChrome', config.browser.useChrome);
  addBooleanError(errors, 'browser.headless', config.browser.headless);
  addBooleanError(errors, 'browser.keepOpen', config.browser.keepOpen);
  addPositiveNumberError(errors, 'browser.challengeTimeoutMs', config.browser.challengeTimeoutMs);
  addPositiveNumberError(errors, 'browser.viewport.width', config.browser.viewport.width);
  addPositiveNumberError(errors, 'browser.viewport.height', config.browser.viewport.height);

  if (!isIntegerInRange(config.browser.proxy.port, 0, 65535)) {
    errors.push('browser.proxy.port 必须是 0 到 65535 的整数');
  }

  if (!isHttpUrl(config.startUrl)) {
    errors.push('startUrl 必须是 http 或 https URL');
  }

  if (config.mail.baseUrl.trim().length > 0 && !isHttpUrl(config.mail.baseUrl)) {
    errors.push('mail.baseUrl 必须是 http 或 https URL');
  }
  addPositiveNumberError(errors, 'mail.pollIntervalMs', config.mail.pollIntervalMs);
  addIntegerError(errors, 'mail.maxAttempts', config.mail.maxAttempts);
  addPositiveNumberError(errors, 'mail.maxAttempts', config.mail.maxAttempts);

  if (!smsProviders.includes(config.sms.provider)) {
    errors.push('sms.provider 必须是 hero-sms 或 5sim');
  }
  addPositiveNumberError(errors, 'sms.pollIntervalMs', config.sms.pollIntervalMs);
  addIntegerError(errors, 'sms.maxAttempts', config.sms.maxAttempts);
  addPositiveNumberError(errors, 'sms.maxAttempts', config.sms.maxAttempts);
  addIntegerError(errors, 'sms.numberMaxRetries', config.sms.numberMaxRetries);
  addPositiveNumberError(errors, 'sms.numberMaxRetries', config.sms.numberMaxRetries);

  config.sms.heroSms.countries.forEach((country, index) => {
    const prefix = `sms.heroSms.countries[${index}]`;
    if (!country.browserOptionKey.trim() && !country.browserDialCode.trim()) {
      errors.push(`${prefix} 至少要填写 browserOptionKey 或 browserDialCode`);
    }
    if (!isFiniteNumber(country.providerCountry)) {
      errors.push(`${prefix}.providerCountry 必须是有效数字`);
    }
    addIntegerError(errors, `${prefix}.order`, country.order);
    addNonNegativeNumberError(errors, `${prefix}.maxPrice`, country.maxPrice);
  });

  config.sms.fiveSim.countries.forEach((country, index) => {
    const prefix = `sms.fiveSim.countries[${index}]`;
    if (!country.browserOptionKey.trim() && !country.browserDialCode.trim() && !country.providerCountry.trim() && !country.providerOperator.trim()) {
      errors.push(`${prefix} 至少要填写 browserOptionKey、browserDialCode、providerCountry 或 providerOperator`);
    }
    addIntegerError(errors, `${prefix}.order`, country.order);
    addNonNegativeNumberError(errors, `${prefix}.maxPrice`, country.maxPrice);
  });

  addBooleanError(errors, 'sync.enabled', config.sync.enabled);
  if (!isIntegerInRange(config.sync.port, 1, 65535)) {
    errors.push('sync.port 必须是 1 到 65535 的整数');
  }
  if (config.sync.enabled) {
    addRequiredStringError(errors, 'sync.host', config.sync.host);
    addRequiredStringError(errors, 'sync.username', config.sync.username);
    addRequiredStringError(errors, 'sync.password', config.sync.password);
    addRequiredStringError(errors, 'sync.remotePath', config.sync.remotePath);
  }

  if (!isHttpUrl(config.oauth.authorizeUrl)) {
    errors.push('oauth.authorizeUrl 必须是 http 或 https URL');
  }
  if (!isHttpUrl(config.oauth.tokenUrl)) {
    errors.push('oauth.tokenUrl 必须是 http 或 https URL');
  }
  if (!isIntegerInRange(config.oauth.redirectPort, 1, 65535)) {
    errors.push('oauth.redirectPort 必须是 1 到 65535 的整数');
  }
  if (!config.oauth.redirectPath.startsWith('/')) {
    errors.push('oauth.redirectPath 必须以 / 开头');
  }

  return errors;
}

export function assertValidConfig(config: AppConfig): void {
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }
}
