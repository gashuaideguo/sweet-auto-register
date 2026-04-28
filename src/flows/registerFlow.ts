import type {AppConfig} from '../config/types.js';
import {logger} from '../shared/logger.js';
import {BrowserService} from '../browser/BrowserService.js';
import {openAndInspectJourney} from './demo/openAndInspectJourney.js';

export async function registerFlow(config: AppConfig): Promise<void> {
    logger.info('[注册] 开始执行注册流程。');
    const browserService = new BrowserService(config);
    await browserService.launch();
    await openAndInspectJourney(browserService, config);
    logger.info('[注册] keepOpen=false，正在关闭浏览器。');
    await browserService.close();
}
