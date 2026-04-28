import type { BrowserService } from '../../../browser/BrowserService.js';
import type { AuthorizationJourneyContext } from '../types.js';
import type { JourneyStep } from '../../journey/types.js';

export class OpenAuthorizationPageStep implements JourneyStep<AuthorizationJourneyContext> {
  readonly name = 'open-authorization-page';

  constructor(private readonly browserService: BrowserService) {}

  async run(context: AuthorizationJourneyContext): Promise<void> {
    const result = await this.browserService.openPage(context.authorizationUrl);
    context.finalUrl = result.finalUrl;
    context.title = result.title;
  }
}
