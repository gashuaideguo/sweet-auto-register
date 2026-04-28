import type { AppConfig } from '../config/types.js';
import { logger } from '../shared/logger.js';
import { sleep } from '../shared/sleep.js';
import { BrowserService } from './BrowserService.js';

export async function ensureBrowser(config: AppConfig): Promise<void> {
  const browserService = new BrowserService(config);

  await browserService.launch();
  const result = await browserService.openPage(config.startUrl);
  logger.info(`[浏览器] 健康检查通过。title=${result.title || '<empty>'}`);

  if (config.browser.keepOpen) {
    logger.info('[浏览器] keepOpen=true，浏览器将保持打开，直到进程被中断。');
    while (true) {
      await sleep(60_000);
    }
  }

  logger.info('[浏览器] keepOpen=false，浏览器将在当前会话中保持打开。');
  while (true) {
    await sleep(60_000);
  }
}
