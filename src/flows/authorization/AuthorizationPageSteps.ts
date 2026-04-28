import fs from 'node:fs';
import path from 'node:path';
import {logger} from '../../shared/logger.js';
import {sleep} from '../../shared/sleep.js';
import type {PageActions} from '../../pages/types.js';
import type {MailService} from '../../services/mail/MailService.js';
import type {PhoneResourceService} from '../../services/sms/PhoneResourceService.js';
import {MailVerificationCodeProvider} from '../../services/verification/MailVerificationCodeProvider.js';
import type {OAuthService} from '../../services/oauth/OAuthService.js';
import {PageJourneyStep} from '../journey/PageJourneyStep.js';
import type {JourneyAction, JourneyStep} from '../journey/types.js';
import type {AuthorizationJourneyContext} from './types.js';
import {retryAuthorizationFromErrorPage} from './steps/retryAuthorizationFromErrorPage.js';

const FLOW_NAME = '授权';

type AuthorizationStageName = 'login' | 'password' | 'mail-otp' | 'phone' | 'sms-otp' | 'consent' | 'organization' | 'callback';

function actionLog(stage: AuthorizationStageName, action: string, message: string): void {
    logger.info(`[${FLOW_NAME}][${stage}][${action}] ${message}`);
}

class FillAuthorizationEmailAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'fill-authorization-email';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        await this.pageActions.typeIntoSelector('input[name="email"]', context.account.email);
        actionLog('login', this.name, `已将邮箱填入 input[name="email"]：${context.account.email}`);
    }
}

class ClickAuthorizationEmailContinueAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'click-authorization-email-continue';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"][name="intent"][value="email"]', 30000);
        actionLog('login', this.name, '已点击邮箱继续按钮。');
    }
}

class ClickAuthorizationPasswordlessLoginAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'click-authorization-passwordless-login';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        try {
            await this.pageActions.clickElement('button[name="intent"][value="passwordless_login_send_otp"]', 30000);
        } catch {
            await this.pageActions.clickButtonByText('使用一次性验证码登录', 30000);
        }
        actionLog('password', this.name, '已点击使用一次性验证码登录按钮。');
    }
}

class FillAuthorizationOtpCodeAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'fill-authorization-otp-code';

    constructor(
        private readonly pageActions: PageActions,
        private readonly mailService: MailService,
        private readonly options: { intervalMs: number; maxAttempts: number },
    ) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        if (!context.mailSession) {
            throw new Error('Mail session is missing before authorization otp step');
        }

        this.mailService.useSession(context.mailSession);
        const provider = new MailVerificationCodeProvider(this.mailService, this.options);
        const code = await provider.getVerificationCode();
        context.mailVerificationCode = code;
        await this.pageActions.typeIntoSelector('input[name="code"]', code);
        actionLog('mail-otp', this.name, '已将邮箱验证码填入 input[name="code"]。');
    }
}

class ClickAuthorizationOtpContinueAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'click-authorization-otp-continue';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"][name="intent"][value="validate"]', 30000);
        actionLog('mail-otp', this.name, '已点击邮箱验证码继续按钮。');
    }
}

class FillAuthorizationPhoneNumberAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'fill-authorization-phone-number';

    constructor(
        private readonly pageActions: PageActions,
        private readonly phoneResourceService: PhoneResourceService,
    ) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        const state = await this.phoneResourceService.acquirePhone();
        context.phoneVerificationRequired = true;
        context.phoneNumber = state.phoneNumber;
        context.selectedSmsCountry = state.countryConfig;
        await this.pageActions.typeIntoSelector('input#tel[name="__reservedForPhoneNumberInput_tel"]', state.phoneNumber);
        actionLog('phone', this.name, `已填入手机号：${state.phoneNumber}`);
    }
}

class SelectAuthorizationPhoneCountryAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'select-authorization-phone-country';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        const country = context.selectedSmsCountry;
        if (!country) {
            actionLog('phone', this.name, '当前尚未选定手机号国家，跳过国家选择。');
            return;
        }

        await this.pageActions.clickElement('button[aria-haspopup="listbox"][type="button"]', 30000);
        try {
            await this.pageActions.clickElementInScrollableList(
                'div[role="listbox"]',
                `div[role="option"][data-key="${country.browserOptionKey}"]`,
                30000,
            );
        } catch {
            await this.pageActions.clickElementInScrollableListByText(
                'div[role="listbox"]',
                country.browserDialCode,
                30000,
            );
        }
        actionLog('phone', this.name, `已选择手机号国家区号：${country.browserOptionKey} ${country.browserDialCode}`);
    }
}

class ClickAuthorizationPhoneContinueAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'click-authorization-phone-continue';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"]', 30000);
        actionLog('phone', this.name, '已点击手机号继续按钮。');
    }
}

class FillAuthorizationSmsCodeAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'fill-authorization-sms-code';

    constructor(
        private readonly pageActions: PageActions,
        private readonly phoneResourceService: PhoneResourceService,
        private readonly maxPhoneRetries: number,
    ) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        for (let attempt = 1; attempt <= this.maxPhoneRetries; attempt += 1) {
            try {
                const code = await this.phoneResourceService.getVerificationCode();
                context.smsVerificationCode = code;
                await this.pageActions.typeIntoSelector('input[name="code"]', code);
                actionLog('sms-otp', this.name, '已将短信验证码填入 input[name="code"]。');
                return;
            } catch (error) {
                if (attempt >= this.maxPhoneRetries) {
                    throw error;
                }

                logger.warn(`[${FLOW_NAME}][sms-otp][${this.name}] 当前号码收码超时，已取消并准备换号重试。attempt=${attempt}/${this.maxPhoneRetries}`);
                const nextState = await this.phoneResourceService.replacePhone();
                context.phoneVerificationRequired = true;
                context.phoneNumber = nextState.phoneNumber;
                context.selectedSmsCountry = nextState.countryConfig;
                await this.pageActions.typeIntoSelector('input#tel[name="__reservedForPhoneNumberInput_tel"]', nextState.phoneNumber);
                actionLog('sms-otp', this.name, `已重新填入手机号：${nextState.phoneNumber}`);
                await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"]', 30000);
                actionLog('sms-otp', this.name, '已重新点击手机号继续按钮。');
                await this.phoneResourceService.markReady();
                actionLog('sms-otp', this.name, '已重新将手机号激活记录标记为就绪。');
            }
        }
    }
}

class ClickAuthorizationSmsContinueAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'click-authorization-sms-continue';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"]', 30000);
        actionLog('sms-otp', this.name, '已点击短信验证码继续按钮。');
    }
}

class ClickAuthorizationConsentContinueAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'click-authorization-consent-continue';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"]', 30000);
        actionLog('consent', this.name, '已点击 consent 页面继续按钮。');
    }
}

class ClickAuthorizationOrganizationContinueAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'click-authorization-organization-continue';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"]', 30000);
        actionLog('organization', this.name, '已点击 organization 页面继续按钮。');
    }
}

class WaitForAuthorizationCallbackAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'wait-for-authorization-callback';

    constructor(
        private readonly callbackTargets: string[],
        private readonly currentUrlProvider: () => string,
        private readonly capturedUrlProvider: () => string | null,
    ) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        const pattern = new RegExp(this.callbackTargets.map((target) => this.escapeRegExp(target)).join('|'));
        const timeoutMs = 120000;
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const capturedUrl = this.capturedUrlProvider();
            context.capturedCallbackUrl = capturedUrl;
            if (capturedUrl && pattern.test(capturedUrl)) {
                context.finalUrl = capturedUrl;
                actionLog('callback', this.name, `已捕获回调地址：${context.finalUrl}`);
                return;
            }

            const currentUrl = this.currentUrlProvider();
            if (pattern.test(currentUrl)) {
                context.finalUrl = currentUrl;
                actionLog('callback', this.name, `已跳转到回调地址：${context.finalUrl}`);
                return;
            }

            await sleep(500);
        }

        throw new Error(`[${FLOW_NAME}] 等待回调地址超时。targets=${this.callbackTargets.join(',')}`);
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

class ParseAuthorizationCallbackAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'parse-authorization-callback';

    constructor(private readonly oauthService: OAuthService) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        if (!context.finalUrl) {
            throw new Error('[授权] 回调地址缺失，无法解析 callback 参数。');
        }

        const callbackParams = this.oauthService.extractCallbackParams(context.finalUrl);
        if (!callbackParams) {
            throw new Error('[授权] 回调参数解析失败，或 state 校验未通过。');
        }

        if (callbackParams.error) {
            throw new Error(`[授权] OAuth 回调返回错误：${callbackParams.error} ${callbackParams.errorDescription ?? ''}`.trim());
        }

        if (!callbackParams.code) {
            throw new Error('[授权] OAuth 回调中缺少 code。');
        }

        context.callbackParams = callbackParams;
        actionLog('callback', this.name, '已解析 OAuth 回调参数。');
    }
}

class ExchangeAuthorizationTokenAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'exchange-authorization-token';

    constructor(private readonly oauthService: OAuthService) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        const code = context.callbackParams?.code;
        if (!code) {
            throw new Error('[授权] 缺少授权码，无法交换 token。');
        }

        context.tokenResponse = await this.oauthService.exchangeToken(code, context.account.email);
        actionLog('callback', this.name, '已完成 token 交换。');
    }
}

class SaveAuthorizationResultAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'save-authorization-result';

    async run(context: AuthorizationJourneyContext): Promise<void> {
        if (!context.tokenResponse) {
            throw new Error('[授权] 缺少 token 响应，无法保存授权结果。');
        }

        const directory = path.join(process.cwd(), 'auth', 'cpa');
        fs.mkdirSync(directory, {recursive: true});

        const email = context.tokenResponse.email || context.account.email;
        const safeEmail = email.replace(/[\\/:*?"<>|]/g, '_') || 'unknown';
        const filePath = path.join(directory, `codex-${safeEmail}-free.json`);

        fs.writeFileSync(filePath, `${JSON.stringify(context.tokenResponse, null, 2)}\n`, 'utf8');
        actionLog('callback', this.name, `Token 已保存：${filePath}`);

        if (context.account.filePath && fs.existsSync(context.account.filePath)) {
            fs.unlinkSync(context.account.filePath);
            actionLog('callback', this.name, `已删除注册文件：${context.account.filePath}`);
        }
    }
}

export function createAuthorizationLoginPageStep(pageActions: PageActions): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-login-page', ['login'], 'login', [
        new FillAuthorizationEmailAction(pageActions),
        new ClickAuthorizationEmailContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryAuthorizationFromErrorPage(pageActions, 'authorization-login-page');
    });
}

export function createAuthorizationPasswordPageStep(pageActions: PageActions): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-password-page', ['password'], 'password', [
        new ClickAuthorizationPasswordlessLoginAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryAuthorizationFromErrorPage(pageActions, 'authorization-password-page');
    });
}

export function createAuthorizationMailOtpPageStep(
    pageActions: PageActions,
    mailService: MailService,
    options: { intervalMs: number; maxAttempts: number },
): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-mail-otp-page', ['mail-otp'], 'mail-otp', [
        new FillAuthorizationOtpCodeAction(pageActions, mailService, options),
        new ClickAuthorizationOtpContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryAuthorizationFromErrorPage(pageActions, 'authorization-mail-otp-page');
    });
}

export function createAuthorizationPhonePageStep(
    pageActions: PageActions,
    phoneResourceService: PhoneResourceService,
): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-phone-page', ['phone'], 'phone', [
        new FillAuthorizationPhoneNumberAction(pageActions, phoneResourceService),
        new SelectAuthorizationPhoneCountryAction(pageActions),
        new ClickAuthorizationPhoneContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryAuthorizationFromErrorPage(pageActions, 'authorization-phone-page');
        await phoneResourceService.markReady();
        actionLog('phone', 'mark-authorization-phone-ready', '已将手机号激活记录标记为就绪。');
    });
}

export function createAuthorizationSmsOtpPageStep(
    pageActions: PageActions,
    phoneResourceService: PhoneResourceService,
    maxPhoneRetries: number,
): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-sms-otp-page', ['sms-otp'], 'sms-otp', [
        new FillAuthorizationSmsCodeAction(pageActions, phoneResourceService, maxPhoneRetries),
        new ClickAuthorizationSmsContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryAuthorizationFromErrorPage(pageActions, 'authorization-sms-otp-page');
        await phoneResourceService.markVerificationSucceeded();
        actionLog('sms-otp', 'mark-authorization-verification-succeeded', '已将手机号验证状态标记为成功。');
    });
}

export function createAuthorizationConsentPageStep(pageActions: PageActions): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-consent-page', ['consent'], 'consent', [
        new ClickAuthorizationConsentContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryAuthorizationFromErrorPage(pageActions, 'authorization-consent-page');
    });
}

export function createAuthorizationOrganizationPageStep(pageActions: PageActions): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-organization-page', ['organization'], 'organization', [
        new ClickAuthorizationOrganizationContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryAuthorizationFromErrorPage(pageActions, 'authorization-organization-page');
    });
}

export function createAuthorizationCallbackPageStep(
    oauthService: OAuthService,
    callbackTargets: string[],
    currentUrlProvider: () => string,
    capturedUrlProvider: () => string | null,
): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-callback-page', ['callback'], 'callback', [
        new WaitForAuthorizationCallbackAction(callbackTargets, currentUrlProvider, capturedUrlProvider),
        new ParseAuthorizationCallbackAction(oauthService),
        new ExchangeAuthorizationTokenAction(oauthService),
        new SaveAuthorizationResultAction(),
    ], FLOW_NAME);
}
