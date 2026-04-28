import { logger } from '../../../shared/logger.js';
import { sleep } from '../../../shared/sleep.js';
import type { PageActions } from '../../../pages/types.js';
import { RetryStepSignal } from '../../journey/types.js';

const TRY_AGAIN_SELECTOR = 'button[data-dd-action-name="Try again"]';

export async function retryAuthorizationFromErrorPage(
  pageActions: PageActions,
  targetStepName: string,
): Promise<void> {
  const timeoutMs = 8000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const hasTryAgain = await pageActions.isSelectorVisible(TRY_AGAIN_SELECTOR);
    if (hasTryAgain) {
      logger.warn('[授权] 检测到异常页面，正在点击重试按钮。');
      await pageActions.clickElement(TRY_AGAIN_SELECTOR, 10000);
      throw new RetryStepSignal(targetStepName);
    }

    await sleep(250);
  }
}
