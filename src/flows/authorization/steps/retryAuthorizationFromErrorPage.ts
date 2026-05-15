import { logger } from '../../../shared/logger.js';
import { sleep } from '../../../shared/sleep.js';
import type { PageActions } from '../../../pages/types.js';
import { RetryStepSignal } from '../../journey/types.js';

const TRY_AGAIN_SELECTOR = 'button[data-dd-action-name="Try again"]';
const RETRY_TIMEOUT_MS = 8000;
const BLANK_PAGE_RELOAD_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 250;

export async function retryAuthorizationFromErrorPage(
  pageActions: PageActions,
  targetStepName: string,
): Promise<void> {
  const start = Date.now();
  let blankPageStart: number | null = null;

  while (Date.now() - start < RETRY_TIMEOUT_MS) {
    const hasTryAgain = await pageActions.isSelectorVisible(TRY_AGAIN_SELECTOR);
    if (hasTryAgain) {
      logger.warn('[授权] 检测到异常页面，正在点击重试按钮。');
      await pageActions.clickElement(TRY_AGAIN_SELECTOR, 10000);
      throw new RetryStepSignal(targetStepName);
    }

    const isBlankPage = await pageActions.isBlankPage();
    if (isBlankPage) {
      blankPageStart ??= Date.now();
      if (Date.now() - blankPageStart >= BLANK_PAGE_RELOAD_TIMEOUT_MS) {
        logger.warn('[授权] 检测到页面持续白屏，正在刷新页面。');
        await pageActions.reload();
        throw new RetryStepSignal(targetStepName);
      }
    } else {
      blankPageStart = null;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
