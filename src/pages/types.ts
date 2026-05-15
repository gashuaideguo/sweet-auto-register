import type { Page } from 'rebrowser-puppeteer-core';

export interface PageActions {
  waitForText(text: string, timeoutMs?: number): Promise<void>;
  waitForUrlMatch(pattern: RegExp, timeoutMs?: number): Promise<void>;
  waitForSelector(selector: string, timeoutMs?: number): Promise<void>;
  clickButtonByText(text: string, timeoutMs?: number): Promise<void>;
  clickElement(selector: string, timeoutMs?: number): Promise<void>;
  clickElementInScrollableList(containerSelector: string, itemSelector: string, timeoutMs?: number): Promise<void>;
  clickElementInScrollableListByText(containerSelector: string, text: string, timeoutMs?: number): Promise<void>;
  isTextVisible(text: string): Promise<boolean>;
  isSelectorVisible(selector: string): Promise<boolean>;
  isBlankPage(): Promise<boolean>;
  reload(timeoutMs?: number): Promise<void>;
  typeIntoSelector(selector: string, value: string): Promise<void>;
  typeIntoSelectorSlowly(selector: string, value: string, delayMs?: number): Promise<void>;
  setInputValue(selector: string, value: string): Promise<void>;
  getTitle(): Promise<string>;
  getHtml(options?: { stableDurationMs?: number; timeoutMs?: number; pollIntervalMs?: number }): Promise<string>;
}

export type PageActionContext = {
  page: Page;
};
