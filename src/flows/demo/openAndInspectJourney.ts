import fs from 'node:fs';
import path from 'node:path';
import type {AppConfig} from '../../config/types.js';
import type {BrowserService} from '../../browser/BrowserService.js';
import {CommonPageActions} from '../../pages/CommonPageActions.js';
import {HttpMailService} from '../../services/mail/HttpMailService.js';
import {logger} from '../../shared/logger.js';
import {JourneyRunner} from '../journey/JourneyRunner.js';
import {resolveRegistrationStage} from '../journey/registration/resolveRegistrationStage.js';
import {OpenHomeStep} from '../journey/steps/OpenHomeStep.js';
import {
    createRegistrationLoginPageStep,
    createRegistrationMailOtpPageStep,
    createRegistrationPasswordPageStep,
    createRegistrationProfilePageStep,
} from '../journey/steps/RegistrationPageSteps.js';
import {WaitForBrowserChallengeStep} from '../journey/steps/WaitForBrowserChallengeStep.js';
import type {JourneyContext, RegistrationStage} from '../journey/types.js';
import type {RegistrationRecord} from '../types.js';

function saveRegistrationRecord(context: JourneyContext): string {
    const directory = path.join(process.cwd(), 'auth', 'register');
    fs.mkdirSync(directory, {recursive: true});

    const email = context.mailSession?.address ?? '';
    const safeEmail = email.replace(/[\\/:*?"<>|]/g, '_') || 'register';
    const filename = `${safeEmail}.json`;
    const filePath = path.join(directory, filename);
    const payload: RegistrationRecord = {
        email,
        password: context.generatedPassword ?? '',
        name: context.generatedFullName ?? '',
        age: context.generatedAge ?? '',
        jwt: context.mailSession?.jwt ?? '',
        verify_code: context.mailVerificationCode ?? '',
    };

    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return filePath;
}

export async function openAndInspectJourney(browserService: BrowserService, config: AppConfig): Promise<void> {
    const page = browserService.getPage();
    const pageActions = new CommonPageActions(page);
    const mailService = new HttpMailService(config.mail);
    const waitForChallengeStep = new WaitForBrowserChallengeStep(browserService, config.browser.challengeTimeoutMs);

    const initialContext: JourneyContext = {
        startUrl: config.startUrl,
    };
    await new OpenHomeStep(browserService).run(initialContext);
    await waitForChallengeStep.run(initialContext);

    const runner = new JourneyRunner<JourneyContext, RegistrationStage>([
        createRegistrationLoginPageStep(pageActions, mailService),
        createRegistrationPasswordPageStep(pageActions),
        createRegistrationMailOtpPageStep(pageActions, mailService, {
            intervalMs: config.mail.pollIntervalMs,
            maxAttempts: config.mail.maxAttempts,
        }),
        createRegistrationProfilePageStep(pageActions),
    ], {
        currentUrl: () => page.url(),
        resolveStage: (url) => resolveRegistrationStage(url),
        isTerminalStage: (stage) => stage === 'done',
        applyStage: (context, stage, url) => {
            context.currentStage = stage;
            context.currentUrl = url;
            context.finalUrl = url;
        },
        afterStep: async () => {
            await browserService.waitForChallenge(config.browser.challengeTimeoutMs);
        },
        stageTimeoutMs: 30000,
    });

    const context = await runner.run(initialContext);
    const recordPath = saveRegistrationRecord(context);

    logger.info(`[注册] 流程执行完成。title=${context.title || '<empty>'} url=${context.finalUrl || config.startUrl}`);
    logger.info(`[注册] 注册结果已保存：${recordPath}`);
}
