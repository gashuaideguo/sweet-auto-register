import {logger} from '../../shared/logger.js';
import {sleep} from '../../shared/sleep.js';
import type {JourneyAction, JourneyStep} from './types.js';

export class PageJourneyStep<TContext> implements JourneyStep<TContext> {
    constructor(
        readonly name: string,
        readonly stages: string[],
        readonly logScope: string,
        private readonly actions: JourneyAction<TContext>[],
        private readonly flowName = '注册',
        private readonly afterRun?: (context: TContext) => Promise<void>,
    ) {
    }

    async run(context: TContext): Promise<void> {
        for (const action of this.actions) {
            const actionScope = action.logScope ?? this.logScope;
            logger.info(`[${this.flowName}][${actionScope}]开始执行action：${action.name}`);
            await action.run(context);
            await sleep(1000);
        }

        if (this.afterRun) {
            await this.afterRun(context);
        }
    }
}
