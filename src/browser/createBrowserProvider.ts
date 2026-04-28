import type { AppConfig } from '../config/types.js';
import { RealBrowserProvider } from './RealBrowserProvider.js';
import type { BrowserProvider } from './types.js';

export function createBrowserProvider(config: AppConfig): BrowserProvider {
  return new RealBrowserProvider(config);
}
