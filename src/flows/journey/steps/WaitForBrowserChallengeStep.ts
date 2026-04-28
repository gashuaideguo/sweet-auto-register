import type { BrowserService } from '../../../browser/BrowserService.js';
import type { JourneyContext, JourneyStep } from '../types.js';

export class WaitForBrowserChallengeStep<TContext = JourneyContext> implements JourneyStep<TContext> {
  readonly name = 'wait-for-browser-challenge';

  constructor(
    private readonly browserService: BrowserService,
    private readonly timeoutMs: number,
  ) {}

  async run(_context: TContext): Promise<void> {
    await this.browserService.waitForChallenge(this.timeoutMs);
  }
}
