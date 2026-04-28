import { logger } from '../shared/logger.js';
import { sleep } from '../shared/sleep.js';
import type { Page } from 'rebrowser-puppeteer-core';
import type { PageActions } from './types.js';

type InteractionContext = Page;

export class CommonPageActions implements PageActions {
  constructor(private readonly page: Page) {}

  async waitForText(text: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const found = await this.page.evaluate((target) => document.body?.innerText?.includes(target) ?? false, text);
        if (found) {
          return;
        }
      } catch (error) {
        if (!this.isRetryableContextError(error)) {
          throw error;
        }
      }

      await sleep(500);
    }

    throw new Error(`Timed out waiting for text: ${text}`);
  }

  async waitForUrlMatch(pattern: RegExp, timeoutMs = 30000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        if (pattern.test(this.page.url())) {
          return;
        }
      } catch (error) {
        if (!this.isRetryableContextError(error)) {
          throw error;
        }
      }

      await sleep(500);
    }

    throw new Error(`Timed out waiting for URL match: ${pattern.source}`);
  }

  async waitForSelector(selector: string, timeoutMs = 30000): Promise<void> {
    await this.findVisibleContext(selector, timeoutMs);
  }

  async clickButtonByText(text: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const clicked = await this.page.evaluate((target) => {
          for (const element of document.querySelectorAll('button, [role="button"], a, div')) {
            if (element.textContent?.trim() === target || element.textContent?.includes(target)) {
              (element as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, text);

        if (clicked) {
          logger.info(`[页面操作] 已通过文本点击按钮：${text}`);
          return;
        }
      } catch (error) {
        if (!this.isRetryableContextError(error)) {
          throw error;
        }
      }

      await sleep(500);
    }

    throw new Error(`Timed out clicking button: ${text}`);
  }

  async clickElement(selector: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const context = await this.findVisibleContext(selector, timeoutMs - (Date.now() - start));

        await context.waitForFunction(
          (target) => {
            const element = document.querySelector(target);
            if (!(element instanceof HTMLElement)) {
              return false;
            }
            if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') {
              return false;
            }
            return element.getClientRects().length > 0;
          },
          { timeout: Math.max(1, timeoutMs - (Date.now() - start)) },
          selector,
        );

        await sleep(1000);

        const clicked = await context.evaluate((target) => {
          const element = document.querySelector(target);
          if (!(element instanceof HTMLElement)) {
            return false;
          }
          element.scrollIntoView({ block: 'center', inline: 'center' });
          element.click();
          return true;
        }, selector);

        if (!clicked) {
          throw new Error(`Failed to click element: ${selector}`);
        }

        logger.info(`[页面操作] 已点击元素：${selector}`);
        return;
      } catch (error) {
        if (!this.isRetryableContextError(error) || Date.now() - start >= timeoutMs) {
          throw error;
        }
        await sleep(250);
      }
    }

    throw new Error(`Timed out clicking element: ${selector}`);
  }

  async clickElementInScrollableList(containerSelector: string, itemSelector: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const clicked = await this.page.evaluate((containerTarget, itemTarget) => {
          const container = document.querySelector(containerTarget);
          if (!(container instanceof HTMLElement)) {
            return false;
          }

          const item = container.querySelector(itemTarget);
          if (item instanceof HTMLElement) {
            item.scrollIntoView({ block: 'center', inline: 'center' });
            item.click();
            return true;
          }

          const nextScrollTop = Math.min(
            container.scrollTop + container.clientHeight,
            Math.max(0, container.scrollHeight - container.clientHeight),
          );
          if (nextScrollTop === container.scrollTop) {
            container.scrollTop = 0;
          } else {
            container.scrollTop = nextScrollTop;
          }
          container.dispatchEvent(new Event('scroll', { bubbles: true }));
          return false;
        }, containerSelector, itemSelector);

        if (clicked) {
          logger.info(`[页面操作] 已在滚动列表中点击元素：${itemSelector}`);
          return;
        }
      } catch (error) {
        if (!this.isRetryableContextError(error)) {
          throw error;
        }
      }

      await sleep(250);
    }

    throw new Error(`Timed out clicking element in scrollable list: ${itemSelector}`);
  }

  async clickElementInScrollableListByText(containerSelector: string, text: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const clicked = await this.page.evaluate((containerTarget, targetText) => {
          const container = document.querySelector(containerTarget);
          if (!(container instanceof HTMLElement)) {
            return false;
          }

          const normalizedTarget = targetText.replace(/[\s()]/g, '').toLowerCase();
          for (const item of container.querySelectorAll('[role="option"]')) {
            if (!(item instanceof HTMLElement)) {
              continue;
            }

            const textContent = (item.innerText || item.textContent || '').replace(/[\s()]/g, '').toLowerCase();
            if (textContent.includes(normalizedTarget)) {
              item.scrollIntoView({ block: 'center', inline: 'center' });
              item.click();
              return true;
            }
          }

          const nextScrollTop = Math.min(
            container.scrollTop + container.clientHeight,
            Math.max(0, container.scrollHeight - container.clientHeight),
          );
          if (nextScrollTop === container.scrollTop) {
            container.scrollTop = 0;
          } else {
            container.scrollTop = nextScrollTop;
          }
          container.dispatchEvent(new Event('scroll', { bubbles: true }));
          return false;
        }, containerSelector, text);

        if (clicked) {
          logger.info(`[页面操作] 已在滚动列表中按文本点击元素：${text}`);
          return;
        }
      } catch (error) {
        if (!this.isRetryableContextError(error)) {
          throw error;
        }
      }

      await sleep(250);
    }

    throw new Error(`Timed out clicking element in scrollable list by text: ${text}`);
  }

  async isTextVisible(text: string): Promise<boolean> {
    try {
      return await this.page.evaluate((target) => document.body?.innerText?.includes(target) ?? false, text);
    } catch (error) {
      if (this.isRetryableContextError(error)) {
        return false;
      }
      throw error;
    }
  }

  async isSelectorVisible(selector: string): Promise<boolean> {
    try {
      return await this.page.evaluate((target) => {
        const element = document.querySelector(target);
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }, selector);
    } catch (error) {
      if (this.isRetryableContextError(error)) {
        return false;
      }
      throw error;
    }
  }

  async typeIntoSelector(selector: string, value: string): Promise<void> {
    const timeoutMs = 30000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const context = await this.findVisibleContext(selector, timeoutMs - (Date.now() - start));

        await context.focus(selector);
        await context.click(selector, { clickCount: 3 });
        const updated = await context.evaluate(
          (target, nextValue) => {
            const element = document.querySelector(target);
            if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
              return false;
            }

            const prototype = element instanceof HTMLInputElement
              ? HTMLInputElement.prototype
              : HTMLTextAreaElement.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            descriptor?.set?.call(element, '');
            element.dispatchEvent(new Event('input', { bubbles: true }));
            descriptor?.set?.call(element, nextValue);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          },
          selector,
          value,
        );

        if (!updated) {
          throw new Error(`Failed to type into element: ${selector}`);
        }

        return;
      } catch (error) {
        if (!this.isRetryableContextError(error) || Date.now() - start >= timeoutMs) {
          throw error;
        }
        await sleep(250);
      }
    }

    throw new Error(`Timed out typing into element: ${selector}`);
  }

  async setInputValue(selector: string, value: string): Promise<void> {
    const timeoutMs = 30000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const updated = await this.page.evaluate(
          (target, nextValue) => {
            const element = document.querySelector(target);
            if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
              return false;
            }

            const prototype = element instanceof HTMLInputElement
              ? HTMLInputElement.prototype
              : HTMLTextAreaElement.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            descriptor?.set?.call(element, nextValue);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          },
          selector,
          value,
        );

        if (!updated) {
          throw new Error(`Failed to set input value: ${selector}`);
        }

        logger.info(`[页面操作] 已设置输入框值：${selector}`);
        return;
      } catch (error) {
        if (!this.isRetryableContextError(error) || Date.now() - start >= timeoutMs) {
          throw error;
        }
        await sleep(250);
      }
    }

    throw new Error(`Timed out setting input value: ${selector}`);
  }

  async getTitle(): Promise<string> {
    const timeoutMs = 10000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        return await this.page.title();
      } catch (error) {
        if (!this.isRetryableContextError(error) || Date.now() - start >= timeoutMs) {
          throw error;
        }
        await sleep(250);
      }
    }

    throw new Error('Timed out getting page title');
  }

  private getInteractionContexts(): InteractionContext[] {
    return [this.page];
  }

  private async findVisibleContext(selector: string, timeoutMs: number): Promise<InteractionContext> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      for (const context of this.getInteractionContexts()) {
        const isVisible = await context.evaluate((target) => {
          const element = document.querySelector(target);
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          const style = window.getComputedStyle(element);
          return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }, selector).catch(() => false);

        if (isVisible) {
          return context;
        }
      }

      await sleep(250);
    }

    throw new Error(`Timed out finding visible element: ${selector}`);
  }

  private isRetryableContextError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return [
      'Attempted to use detached Frame',
      'Execution context was destroyed',
      'Cannot find context with specified id',
      'Target closed',
    ].some((message) => error.message.includes(message));
  }
}
