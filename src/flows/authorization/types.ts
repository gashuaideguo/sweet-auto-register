import type {SmsCountryConfig} from '../../config/types.js';
import type {MailSession} from '../../services/mail/types.js';
import type {OAuthCallbackParams, OAuthTokenResponse} from '../../services/oauth/OAuthService.js';
import type {RegistrationRecord} from '../types.js';

export type AuthorizationStage = 'login' | 'password' | 'mail-otp' | 'phone' | 'sms-otp' | 'consent' | 'organization' | 'callback' | 'done';

export type AuthorizationJourneyContext = {
  authorizationUrl: string;
  redirectUri: string;
  account: RegistrationRecord & { filePath: string };
  finalUrl?: string;
  title?: string;
  currentUrl?: string;
  currentStage?: AuthorizationStage;
  capturedCallbackUrl?: string | null;
  mailSession?: MailSession;
  mailVerificationCode?: string;
  phoneVerificationRequired?: boolean;
  phoneVerificationSucceeded?: boolean;
  phoneNumber?: string;
  smsVerificationCode?: string;
  selectedSmsCountry?: SmsCountryConfig;
  callbackParams?: OAuthCallbackParams;
  tokenResponse?: OAuthTokenResponse;
};
