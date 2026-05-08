import type {AppConfig} from '../config/types.js';
import {BrowserService} from '../browser/BrowserService.js';
import {logger} from '../shared/logger.js';
import {openAuthorizationJourney} from './demo/openAuthorizationJourney.js';
import type {RegistrationRecord} from './types.js';

export type AuthorizationAccount = RegistrationRecord & {
    filePath: string;
};

export async function authorizationFlow(config: AppConfig, account: AuthorizationAccount): Promise<void> {
    logger.info(`[授权] 开始执行 OAuth 占位授权流程。email=${account.email}`);
    const browserService = new BrowserService(config);

    try {
        await browserService.launch();
        await openAuthorizationJourney(browserService, config, account);
    } catch (error) {
        await browserService.screenshotOnError('authorization');
        throw error;
    } finally {
        logger.info('[授权] keepOpen=false，正在关闭浏览器。');
        await browserService.close();
    }
}
