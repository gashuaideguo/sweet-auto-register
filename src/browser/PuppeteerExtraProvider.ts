import { addExtra, type PuppeteerExtraPlugin, type VanillaPuppeteer } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import puppeteerCore, { type Browser, type LaunchOptions, type Page } from 'rebrowser-puppeteer-core';
import type { AppConfig } from '../config/types.js';
import type { BrowserLaunchContext, BrowserProvider } from './types.js';

type PuppeteerExtraCore = {
  use(plugin: PuppeteerExtraPlugin): PuppeteerExtraCore;
  launch(options?: LaunchOptions): Promise<Browser>;
};

const puppeteer = addExtra(puppeteerCore as unknown as VanillaPuppeteer) as unknown as PuppeteerExtraCore;
puppeteer.use(StealthPlugin());

export class PuppeteerExtraProvider implements BrowserProvider {
  constructor(private readonly config: AppConfig) {}

  async launch(): Promise<BrowserLaunchContext> {
    const browser = await puppeteer.launch(this.buildLaunchOptions());
    const page = await browser.newPage() as Page;

    if (this.config.browser.proxy.username || this.config.browser.proxy.password) {
      await page.authenticate({
        username: this.config.browser.proxy.username,
        password: this.config.browser.proxy.password,
      });
    }

    await page.setViewport(this.config.browser.viewport);

    return { browser, page };
  }

  private buildLaunchOptions(): LaunchOptions {
    const executablePath = this.config.browser.useChrome && this.config.browser.chromePath ? this.config.browser.chromePath : undefined;

    return {
      headless: this.config.browser.headless,
      executablePath,
      channel: this.config.browser.useChrome && !executablePath ? 'chrome' : undefined,
      defaultViewport: this.config.browser.viewport,
      args: this.buildArgs(),
    };
  }

  private buildArgs(): string[] {
    const args = ['--disable-gpu'];

    if (this.config.browser.proxy.host && this.config.browser.proxy.port > 0) {
      args.push(`--proxy-server=${this.config.browser.proxy.host}:${this.config.browser.proxy.port}`);
    }

    return args;
  }
}
