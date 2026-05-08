import type { AppConfig } from '../config/types.js';
import { PuppeteerExtraProvider } from './PuppeteerExtraProvider.js';
import { RealBrowserProvider } from './RealBrowserProvider.js';
import type { BrowserProvider } from './types.js';

export function createBrowserProvider(config: AppConfig): BrowserProvider {
  if (config.browser.provider === 'puppeteer-extra') {
    return new PuppeteerExtraProvider(config);
  }

  return new RealBrowserProvider(config);
}
