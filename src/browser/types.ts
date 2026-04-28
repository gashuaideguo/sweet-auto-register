import type { Browser, Page } from 'rebrowser-puppeteer-core';

type Viewport = {
  width: number;
  height: number;
};

export type BrowserLaunchContext = {
  browser: Browser;
  page: Page;
};

export type BrowserStartResult = {
  finalUrl: string;
  title: string;
};

export type RealBrowserConnectOptions = {
  args: string[];
  headless: boolean;
  customConfig: {
    chromePath?: string;
  };
  proxy?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
  turnstile: boolean;
  connectOption?: {
    defaultViewport: Viewport;
  };
};

export interface BrowserProvider {
  launch(): Promise<BrowserLaunchContext>;
}
