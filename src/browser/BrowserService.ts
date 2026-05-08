import fs from 'node:fs';
import path from 'node:path';
import type {Browser, Page} from 'rebrowser-puppeteer-core';
import type {AppConfig} from '../config/types.js';
import {logger} from '../shared/logger.js';
import {sleep} from '../shared/sleep.js';
import {createBrowserProvider} from './createBrowserProvider.js';
import type {BrowserStartResult} from './types.js';

const challengeMarkers = [
    'just a moment',
    'checking your browser',
    'verify you are human',
    'checking if the site connection is secure',
    '稍候',
    'moment',
    'checking',
];

export class BrowserService {
    private browser: Browser | null = null;
    private page: Page | null = null;

    constructor(private readonly config: AppConfig) {
    }

    async launch(): Promise<void> {
        logger.info(`[浏览器] 正在启动。provider=${this.config.browser.provider} headless=${String(this.config.browser.headless)}`);
        const provider = createBrowserProvider(this.config);
        const context = await provider.launch();
        this.browser = context.browser;
        this.page = context.page;
        logger.info('[浏览器] 启动成功。');
    }

    getBrowser(): Browser {
        if (!this.browser) {
            throw new Error('Browser is not initialized. Call launch() first.');
        }

        return this.browser;
    }

    getPage(): Page {
        if (!this.page) {
            throw new Error('Browser page is not initialized. Call launch() first.');
        }

        return this.page;
    }

    async openPage(url: string): Promise<BrowserStartResult> {
        const page = this.getPage();
        const maxAttempts = 3;

        logger.info(`[浏览器] 正在打开页面：${url}`);

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000,
                });

                const finalUrl = page.url();
                const title = await page.title();
                logger.info(`[浏览器] 页面加载完成：${finalUrl}`);

                return {finalUrl, title};
            } catch (error) {
                if (!this.isRetryableNavigationError(error) || attempt >= maxAttempts) {
                    throw error;
                }

                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`[浏览器] 页面打开失败，准备重试。attempt=${attempt}/${maxAttempts} error=${message}`);
                await sleep(2000);
            }
        }

        throw new Error(`Failed to open page: ${url}`);
    }

    async waitForChallenge(timeoutMs = this.config.browser.challengeTimeoutMs): Promise<void> {
        const page = this.getPage();
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            let snapshot = '';

            try {
                const title = await page.title();
                const bodyText = await page.evaluate(() => document.body?.innerText || '');
                snapshot = `${title}\n${bodyText}`.toLowerCase();
            } catch {
                await sleep(1000);
                continue;
            }

            const inChallenge = challengeMarkers.some((marker) => snapshot.includes(marker));
            if (!inChallenge) {
                logger.info('[浏览器] 未检测到验证页，或验证已通过。');
                return;
            }
            logger.info('[浏览器] 检测到验证页，继续等待。');
            await sleep(3000);
        }

        throw new Error('Browser challenge timeout');
    }

    async screenshot(filePath: string): Promise<void> {
        const page = this.getPage();
        await page.screenshot({path: filePath});
        logger.info(`[浏览器] 截图已保存：${filePath}`);
    }

    async screenshotOnError(scope: string): Promise<void> {
        if (!this.page) {
            logger.warn('[浏览器] 当前没有可截图页面，已跳过错误截图。');
            return;
        }

        const directory = path.join(process.cwd(), 'auth', 'screenshots');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = path.join(directory, `${scope}-${timestamp}.png`);

        try {
            fs.mkdirSync(directory, {recursive: true});
            await this.screenshot(filePath);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`[浏览器] 错误截图失败：${message}`);
        }
    }

    async close(): Promise<void> {
        if (!this.browser) {
            return;
        }

        await this.browser.close();
        this.browser = null;
        this.page = null;
        logger.info('[浏览器] 已关闭。');
    }

    private isRetryableNavigationError(error: unknown): boolean {
        if (!(error instanceof Error)) {
            return false;
        }

        return [
            'net::ERR_CONNECTION_CLOSED',
            'net::ERR_CONNECTION_RESET',
            'net::ERR_CONNECTION_ABORTED',
            'net::ERR_TIMED_OUT',
            'net::ERR_NETWORK_CHANGED',
        ].some((message) => error.message.includes(message));
    }
}
