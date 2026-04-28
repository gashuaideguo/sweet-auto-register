import { connect } from 'puppeteer-real-browser';
import type { AppConfig } from '../config/types.js';
import { buildRealBrowserOptions } from './buildRealBrowserOptions.js';
import type { BrowserLaunchContext, BrowserProvider } from './types.js';

export class RealBrowserProvider implements BrowserProvider {
  constructor(private readonly config: AppConfig) {}

  async launch(): Promise<BrowserLaunchContext> {
    const { browser, page } = await connect(buildRealBrowserOptions(this.config));
    const pages = await browser.pages();
    const targetPage = pages.length > 0 ? await browser.newPage() : page;

    await targetPage.bringToFront();
    await targetPage.setViewport(this.config.browser.viewport);

    return { browser, page: targetPage };
  }
}
