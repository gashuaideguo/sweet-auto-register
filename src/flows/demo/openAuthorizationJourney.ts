import type {AppConfig} from '../../config/types.js';
import type {BrowserService} from '../../browser/BrowserService.js';
import {logger} from '../../shared/logger.js';
import {OAuthService} from '../../services/oauth/OAuthService.js';
import {HttpMailService} from '../../services/mail/HttpMailService.js';
import {createSmsService} from '../../services/sms/createSmsService.js';
import {PhoneResourceService} from '../../services/sms/PhoneResourceService.js';
import type {AuthorizationAccount} from '../authorizationFlow.js';
import {JourneyRunner} from '../journey/JourneyRunner.js';
import {WaitForBrowserChallengeStep} from '../journey/steps/WaitForBrowserChallengeStep.js';
import type {AuthorizationJourneyContext, AuthorizationStage} from '../authorization/types.js';
import {resolveAuthorizationStage} from '../authorization/resolveAuthorizationStage.js';
import {
    createAuthorizationCallbackPageStep,
    createAuthorizationConsentPageStep,
    createAuthorizationLoginPageStep,
    createAuthorizationMailOtpPageStep,
    createAuthorizationOrganizationPageStep,
    createAuthorizationPasswordPageStep,
    createAuthorizationPhonePageStep,
    createAuthorizationSmsOtpPageStep,
} from '../authorization/AuthorizationPageSteps.js';
import {OpenAuthorizationPageStep} from '../authorization/steps/OpenAuthorizationPageStep.js';
import {CommonPageActions} from '../../pages/CommonPageActions.js';

function createAuthorizationPhoneResourceService(config: AppConfig): PhoneResourceService {
    const countries = config.sms.provider === '5sim'
        ? config.sms.fiveSim.countries
        : config.sms.heroSms.countries;

    if (!countries.length) {
        throw new Error(`[授权] ${config.sms.provider} 至少需要配置一个短信国家。`);
    }
    if (config.sms.provider === '5sim') {
        if (!config.sms.fiveSim.apiKey) {
            throw new Error('[授权] sms.fiveSim.apiKey 必填。');
        }
        if (!config.sms.fiveSim.product) {
            throw new Error('[授权] sms.fiveSim.product 必填。');
        }
    } else if (!config.sms.heroSms.apiKey) {
        throw new Error('[授权] sms.heroSms.apiKey 必填。');
    }

    const smsServices = countries.map((country) => ({
        provider: config.sms.provider,
        country,
        smsService: createSmsService(config.sms, country),
    }));

    return new PhoneResourceService(smsServices, {
        provider: config.sms.provider,
        pollIntervalMs: config.sms.pollIntervalMs,
        maxAttempts: config.sms.maxAttempts,
    });
}

export async function openAuthorizationJourney(browserService: BrowserService, config: AppConfig, account: AuthorizationAccount): Promise<void> {
    const oauthService = OAuthService.fromAppConfig(config);
    const browser = browserService.getBrowser();
    const page = browserService.getPage();
    const pageActions = new CommonPageActions(page);
    const mailService = new HttpMailService(config.mail);
    const phoneResourceService = createAuthorizationPhoneResourceService(config);
    const waitForChallengeStep = new WaitForBrowserChallengeStep<AuthorizationJourneyContext>(browserService, config.browser.challengeTimeoutMs);
    const authorizationUrl = oauthService.getAuthUrl();
    const redirectUrl = new URL(oauthService.getRedirectUri());
    const callbackTargets = Array.from(new Set([
        redirectUrl.host,
        `localhost:${redirectUrl.port}`,
    ].filter(Boolean)));
    let capturedCallbackUrl: string | null = null;
    let callbackListenerActive = true;
    const cleanupCallbacks: Array<() => void> = [];
    const instrumentedPages = new WeakSet<object>();

    const captureCallbackUrl = (requestUrl: string): void => {
        if (!callbackListenerActive) {
            return;
        }
        if (!callbackTargets.some((target) => requestUrl.includes(target))) {
            return;
        }
        capturedCallbackUrl = requestUrl;
        logger.info(`[授权] 已监听到回调地址：${requestUrl}`);
    };

    const attachPageListeners = (targetPage: typeof page): void => {
        if (instrumentedPages.has(targetPage)) {
            return;
        }
        instrumentedPages.add(targetPage);

        const onRequest = (request: {url(): string}): void => {
            captureCallbackUrl(request.url());
        };
        const onFrameNavigated = (frame: {url(): string}): void => {
            if (frame === targetPage.mainFrame()) {
                captureCallbackUrl(frame.url());
            }
        };

        targetPage.on('request', onRequest);
        targetPage.on('framenavigated', onFrameNavigated);
        cleanupCallbacks.push(() => {
            targetPage.off('request', onRequest);
            targetPage.off('framenavigated', onFrameNavigated);
        });
    };

    const onTargetCreated = async (target: {page(): Promise<typeof page | null>}): Promise<void> => {
        try {
            const targetPage = await target.page();
            if (!targetPage) {
                return;
            }
            attachPageListeners(targetPage);
        } catch {
            return;
        }
    };

    browser.on('targetcreated', onTargetCreated);
    cleanupCallbacks.push(() => {
        browser.off('targetcreated', onTargetCreated);
    });
    attachPageListeners(page);

    logger.info(`[授权] 已生成授权地址，回调地址：${oauthService.getRedirectUri()} email=${account.email}`);

    const initialContext: AuthorizationJourneyContext = {
        authorizationUrl,
        redirectUri: oauthService.getRedirectUri(),
        account,
        capturedCallbackUrl: null,
        mailSession: {
            address: account.email,
            jwt: account.jwt,
        },
    };

    await new OpenAuthorizationPageStep(browserService).run(initialContext);
    await waitForChallengeStep.run(initialContext);

    const runner = new JourneyRunner<AuthorizationJourneyContext, AuthorizationStage>([
        createAuthorizationLoginPageStep(pageActions),
        createAuthorizationPasswordPageStep(pageActions),
        createAuthorizationMailOtpPageStep(pageActions, mailService, {
            intervalMs: config.mail.pollIntervalMs,
            maxAttempts: config.mail.maxAttempts,
        }),
        createAuthorizationPhonePageStep(pageActions, phoneResourceService, browserService),
        createAuthorizationSmsOtpPageStep(pageActions, phoneResourceService, browserService),
        createAuthorizationConsentPageStep(pageActions),
        createAuthorizationOrganizationPageStep(pageActions),
        createAuthorizationCallbackPageStep(
            oauthService,
            callbackTargets,
            () => page.url(),
            () => capturedCallbackUrl,
            phoneResourceService,
        ),
    ], {
        flowName: '授权',
        currentUrl: () => capturedCallbackUrl ?? page.url(),
        resolveStage: (url, context) => resolveAuthorizationStage(url, context),
        isTerminalStage: (stage) => stage === 'done',
        applyStage: (context, stage, url) => {
            context.currentStage = stage;
            context.currentUrl = url;
            context.finalUrl = url;
            context.capturedCallbackUrl = capturedCallbackUrl;
            if (stage === 'phone') {
                context.phoneVerificationRequired = true;
            }
            if (stage === 'callback' && context.phoneVerificationRequired === undefined) {
                context.phoneVerificationRequired = false;
            }
        },
        afterStep: async () => {
            await browserService.waitForChallenge(config.browser.challengeTimeoutMs);
        },
        stageTimeoutMs: 30000,
    });

    try {
        await runner.run(initialContext);
    } catch (error) {
        if (initialContext.phoneVerificationRequired && !initialContext.phoneVerificationSucceeded) {
            try {
                await phoneResourceService.cancelCurrentPhone();
            } catch (cancelError) {
                const message = cancelError instanceof Error ? cancelError.message : String(cancelError);
                logger.warn(`[授权] 取消当前手机号失败：${message}`);
            }
        }
        throw error;
    } finally {
        callbackListenerActive = false;
        for (const cleanup of cleanupCallbacks) {
            cleanup();
        }
    }
}
