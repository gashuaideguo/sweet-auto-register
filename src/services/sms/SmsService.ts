import type { PhoneProvider } from '../contracts/PhoneProvider.js';
import type { SmsActivation, SmsStatusResult } from './types.js';

export interface SmsService extends PhoneProvider {
  restoreActivation(activation: SmsActivation): void;
  getActivation(): SmsActivation | null;
  markReady(): Promise<void>;
  getStatus(): Promise<SmsStatusResult>;
  complete(): Promise<void>;
  cancel(): Promise<void>;
}
