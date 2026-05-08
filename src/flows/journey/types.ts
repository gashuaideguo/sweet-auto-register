import type {MailSession} from '../../services/mail/types.js';

export type RegistrationStage = 'login' | 'password' | 'mail-otp' | 'profile' | 'done';

export type JourneyContext = {
    startUrl: string;
    finalUrl?: string;
    title?: string;
    currentUrl?: string;
    currentStage?: RegistrationStage;
    mailSession?: MailSession;
    generatedPassword?: string;
    generatedFullName?: string;
    generatedAge?: string;
    mailVerificationCode?: string;
    phone?: string | null;
};

export class RetryStepSignal extends Error {
    constructor(public readonly targetStepName: string) {
        super(`Retry from step: ${targetStepName}`);
        this.name = 'RetryStepSignal';
    }
}

export interface JourneyAction<TContext = JourneyContext> {
    readonly name: string;
    readonly logScope?: string;

    run(context: TContext): Promise<void>;
}

export interface JourneyStep<TContext = JourneyContext> {
    readonly name: string;
    readonly stages?: string[];
    readonly logScope?: string;

    shouldRun?(context: TContext): boolean;

    run(context: TContext): Promise<void>;
}

export type RoutedJourneyOptions<TContext, TStage extends string = string> = {
    currentUrl: (context: TContext) => string | Promise<string>;
    resolveStage: (url: string, context: TContext) => TStage | null | Promise<TStage | null>;
    isTerminalStage: (stage: TStage, context: TContext) => boolean;
    flowName?: string;
    applyStage?: (context: TContext, stage: TStage, url: string) => void;
    afterStep?: (context: TContext) => Promise<void>;
    stageTimeoutMs?: number;
    stepsByStage?: Partial<Record<TStage, JourneyStep<TContext>[]>>;
};
