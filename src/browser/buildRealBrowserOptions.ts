import type { AppConfig } from '../config/types.js';
import type { RealBrowserConnectOptions } from './types.js';

export function buildRealBrowserOptions(config: AppConfig): RealBrowserConnectOptions {
  const args = ['--disable-gpu'];
  const proxy = config.browser.proxy.host && config.browser.proxy.port > 0
    ? {
        host: config.browser.proxy.host,
        port: config.browser.proxy.port,
        ...(config.browser.proxy.username ? { username: config.browser.proxy.username } : {}),
        ...(config.browser.proxy.password ? { password: config.browser.proxy.password } : {}),
      }
    : undefined;

  return {
    headless: config.browser.headless,
    customConfig: config.browser.useChrome && config.browser.chromePath
      ? { chromePath: config.browser.chromePath }
      : {},
    turnstile: config.browser.turnstile,
    args,
    proxy,
  };
}
