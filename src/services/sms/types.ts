import type { SmsCountryConfig, SmsProviderType } from '../../config/types.js';

export type SmsActivation = {
  activationId: number;
  phoneNumber: string;
  activationCost?: number | string;
};

export type PersistedPhoneState = SmsActivation & {
  provider: SmsProviderType | string;
  useCount: number;
  countryCode: string;
  countryConfig: SmsCountryConfig;
  seenVerificationCodes: string[];
  updatedAt: string;
};

export type SmsStatusResult = {
  received: boolean;
  code?: string;
};
