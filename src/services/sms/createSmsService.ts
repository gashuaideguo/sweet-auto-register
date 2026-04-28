import type { FiveSimCountryConfig, HeroSmsCountryConfig, SmsConfig } from '../../config/types.js';
import { HeroSmsService } from './HeroSmsService.js';
import { FiveSimService } from './FiveSimService.js';
import type { SmsService } from './SmsService.js';

function isFiveSimCountry(country: HeroSmsCountryConfig | FiveSimCountryConfig): country is FiveSimCountryConfig {
  return 'providerOperator' in country;
}

export function createSmsService(config: SmsConfig, country: HeroSmsCountryConfig | FiveSimCountryConfig): SmsService {
  if (config.provider === '5sim') {
    if (!isFiveSimCountry(country)) {
      throw new Error('5sim country config is invalid');
    }
    return new FiveSimService(config, country);
  }

  if (isFiveSimCountry(country)) {
    throw new Error('HeroSMS country config is invalid');
  }

  return new HeroSmsService(config, country);
}
