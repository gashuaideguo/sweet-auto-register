import type { BrowserService } from '../../../browser/BrowserService.js';
import type { JourneyContext, JourneyStep } from '../types.js';

export class OpenHomeStep implements JourneyStep {
  readonly name = 'open-home';

  constructor(private readonly browserService: BrowserService) {}

  async run(context: JourneyContext): Promise<void> {
    const result = await this.browserService.openPage(context.startUrl);
    context.finalUrl = result.finalUrl;
    context.title = result.title;
  }
}
