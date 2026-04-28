import {logger} from '../../shared/logger.js';
import {sleep} from '../../shared/sleep.js';
import {RetryStepSignal, type JourneyContext, type JourneyStep, type RoutedJourneyOptions} from './types.js';

export class JourneyRunner<TContext = JourneyContext, TStage extends string = string> {
    constructor(
        private readonly steps: JourneyStep<TContext>[],
        private readonly routedOptions?: RoutedJourneyOptions<TContext, TStage>,
    ) {
    }

    async run(context: TContext): Promise<TContext> {
        if (this.routedOptions) {
            return this.runWithRouting(context, this.routedOptions);
        }

        for (let index = 0; index < this.steps.length; index += 1) {
            const step = this.steps[index];
            if (!step) {
                continue;
            }
            if (step.shouldRun && !step.shouldRun(context)) {
                continue;
            }
            try {
                await this.runStep(step, context, '流程');
            } catch (error) {
                if (error instanceof RetryStepSignal) {
                    const targetIndex = this.steps.findIndex((candidate) => candidate.name === error.targetStepName);
                    if (targetIndex === -1) {
                        throw error;
                    }
                    logger.warn(`[流程] 检测到重试页，准备回退到步骤：${error.targetStepName}`);
                    index = targetIndex - 1;
                    await sleep(1000);
                    continue;
                }
                throw error;
            }
            await sleep(1000);
        }

        return context;
    }

    private async runWithRouting(context: TContext, options: RoutedJourneyOptions<TContext, TStage>): Promise<TContext> {
        const completedStepNames = new Set<string>();
        const flowName = options.flowName ?? '流程';

        while (true) {
            const {stage, url} = await this.waitForRoutedStage(context, options, completedStepNames, flowName);
            if (options.isTerminalStage(stage, context)) {
                logger.info(`[${flowName}] 已进入终态阶段：${stage}`);
                return context;
            }

            const step = this.getNextRoutedStep(stage, context, options, completedStepNames);
            if (!step) {
                throw new Error(`[${flowName}] 当前阶段没有可执行步骤。stage=${stage} url=${url}`);
            }

            try {
                await this.runStep(step, context, flowName);
                completedStepNames.add(step.name);
            } catch (error) {
                if (error instanceof RetryStepSignal) {
                    this.resetCompletedStepsFrom(error.targetStepName, completedStepNames, options, flowName);
                    logger.warn(`[${flowName}] 检测到重试页，准备回退到页面步骤：${error.targetStepName}`);
                    await sleep(1000);
                    continue;
                }
                throw error;
            }

            if (options.afterStep) {
                await options.afterStep(context);
            }
            await sleep(1000);
        }
    }

    private async waitForRoutedStage(
        context: TContext,
        options: RoutedJourneyOptions<TContext, TStage>,
        completedStepNames: Set<string>,
        flowName: string,
    ): Promise<{stage: TStage; url: string}> {
        const timeoutMs = options.stageTimeoutMs ?? 30000;
        const start = Date.now();
        let lastLoggedStageKey = '';
        let lastWaitKey = '';

        while (Date.now() - start < timeoutMs) {
            const url = await options.currentUrl(context);
            const stage = await options.resolveStage(url, context);
            if (stage) {
                options.applyStage?.(context, stage, url);
                const stageKey = `${stage}|${url}`;
                if (stageKey !== lastLoggedStageKey) {
                    logger.info(`[${flowName}] 已解析当前阶段：${stage} url=${url}`);
                    lastLoggedStageKey = stageKey;
                    lastWaitKey = '';
                }
                if (options.isTerminalStage(stage, context)) {
                    return {stage, url};
                }
                if (this.getNextRoutedStep(stage, context, options, completedStepNames)) {
                    return {stage, url};
                }
                if (lastWaitKey !== stageKey) {
                    logger.info(`[${flowName}] 当前阶段无可执行步骤，继续等待阶段变化。stage=${stage}`);
                    lastWaitKey = stageKey;
                }
            }
            await sleep(250);
        }

        const currentUrl = await options.currentUrl(context);
        throw new Error(`[${flowName}] 等待可路由阶段超时。currentUrl=${currentUrl}`);
    }

    private getNextRoutedStep(
        stage: TStage,
        context: TContext,
        options: RoutedJourneyOptions<TContext, TStage>,
        completedStepNames: Set<string>,
    ): JourneyStep<TContext> | null {
        const stageSteps = this.getStageSteps(stage, options);
        for (const step of stageSteps) {
            if (completedStepNames.has(step.name)) {
                continue;
            }
            if (step.stages && !step.stages.includes(String(stage))) {
                continue;
            }
            if (step.shouldRun && !step.shouldRun(context)) {
                continue;
            }
            return step;
        }
        return null;
    }

    private getStageSteps(stage: TStage, options: RoutedJourneyOptions<TContext, TStage>): JourneyStep<TContext>[] {
        if (options.stepsByStage) {
            return options.stepsByStage[stage] ?? [];
        }
        return this.steps;
    }

    private resetCompletedStepsFrom(
        targetStepName: string,
        completedStepNames: Set<string>,
        options: RoutedJourneyOptions<TContext, TStage>,
        flowName: string,
    ): void {
        const configuredSteps = this.getConfiguredSteps(options);
        const hasTarget = configuredSteps.some((step) => step.name === targetStepName);
        if (!hasTarget) {
            throw new Error(`[${flowName}] 未找到重试目标步骤：${targetStepName}`);
        }
        completedStepNames.clear();
    }

    private getConfiguredSteps(options: RoutedJourneyOptions<TContext, TStage>): JourneyStep<TContext>[] {
        if (!options.stepsByStage) {
            return this.steps;
        }

        const configuredSteps: JourneyStep<TContext>[] = [];
        const groupedSteps = Object.values(options.stepsByStage) as Array<JourneyStep<TContext>[] | undefined>;
        for (const steps of groupedSteps) {
            if (!steps) {
                continue;
            }
            configuredSteps.push(...steps);
        }
        return configuredSteps;
    }

    private async runStep(step: JourneyStep<TContext>, context: TContext, flowName: string): Promise<void> {
        const stepScope = step.logScope ? `[${step.logScope}]` : '';
        logger.info(`[${flowName}]${stepScope}开始执行step：${step.name}`);
        await step.run(context);
    }
}
