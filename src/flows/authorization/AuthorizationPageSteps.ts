import fs from 'node:fs';
import path from 'node:path';
import type {BrowserService} from '../../browser/BrowserService.js';
import {logger} from '../../shared/logger.js';
import {sleep} from '../../shared/sleep.js';
import type {PageActions} from '../../pages/types.js';
import type {MailService} from '../../services/mail/MailService.js';
import type {PhoneResourceService} from '../../services/sms/PhoneResourceService.js';
import type {PersistedPhoneState} from '../../services/sms/types.js';
import {MailVerificationCodeProvider} from '../../services/verification/MailVerificationCodeProvider.js';
import type {OAuthService} from '../../services/oauth/OAuthService.js';
import {PageJourneyStep} from '../journey/PageJourneyStep.js';
import type {JourneyAction, JourneyStep} from '../journey/types.js';
import type {AuthorizationJourneyContext} from './types.js';
import {retryAuthorizationFromErrorPage} from './steps/retryAuthorizationFromErrorPage.js';

const FLOW_NAME = '授权';

type AuthorizationStageName = 'login' | 'password' | 'mail-otp' | 'phone' | 'sms-otp' | 'consent' | 'organization' | 'callback';

const PHONE_INPUT_SELECTOR = 'input#tel[name="__reservedForPhoneNumberInput_tel"]';
const PHONE_ERROR_ICON_SELECTOR = 'svg[title="错误"], svg[title="error"], svg[title="Error"]';
const PHONE_ERROR_WAIT_TIMEOUT_MS = 15000;
const PHONE_ERROR_WAIT_INTERVAL_MS = 500;
const PHONE_HTML_DIR = path.join(process.cwd(), 'auth', 'html');
const UNUSABLE_PHONE_SCREENSHOT_DIR = path.join(process.cwd(), 'screenshots', 'unusable-phones');

function actionLog(stage: AuthorizationStageName, action: string, message: string): void {
    logger.info(`[${FLOW_NAME}][${stage}][${action}] ${message}`);
}

function createHtmlSnapshotPath(prefix: string): string {
    fs.mkdirSync(PHONE_HTML_DIR, {recursive: true});
    const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
    return path.join(PHONE_HTML_DIR, `${prefix}-${timestamp}.html`);
}

function createUnusablePhoneScreenshotPath(phoneNumber?: string): string {
    const safePhoneNumber = (phoneNumber || 'unknown-phone').replace(/[\\/:*?"<>|\s]+/g, '_');
    const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
    return path.join(UNUSABLE_PHONE_SCREENSHOT_DIR, `${safePhoneNumber}-${timestamp}.png`);
}

async function saveUsedPhoneCancellationScreenshot(
    browserService: BrowserService,
    state: PersistedPhoneState | null,
    stage: AuthorizationStageName,
    actionName: string,
): Promise<void> {
    if (!state || state.useCount <= 0) {
        return;
    }

    const filePath = createUnusablePhoneScreenshotPath(state.phoneNumber);

    try {
        fs.mkdirSync(UNUSABLE_PHONE_SCREENSHOT_DIR, {recursive: true});
        await browserService.screenshot(filePath);
        actionLog(stage, actionName, `已使用手机号取消前页面截图已保存：${filePath} useCount=${state.useCount}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[${FLOW_NAME}][${stage}][${actionName}] 已使用手机号取消前截图失败，将继续后续流程。filePath=${filePath} useCount=${state.useCount} error=${message}`);
    }
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
        private readonly browserService: BrowserService,
    ) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        await this.acquireAndFillPhoneNumber(context);
    }

    async acquireAndFillPhoneNumber(context: AuthorizationJourneyContext): Promise<void> {
        const state = await this.phoneResourceService.acquirePhone();
        await this.fillPhoneNumber(context, state);
    }

    async replaceAndFillPhoneNumber(context: AuthorizationJourneyContext): Promise<void> {
        await saveUsedPhoneCancellationScreenshot(this.browserService, this.phoneResourceService.getCurrentPhoneState(), 'phone', this.name);
        const state = await this.phoneResourceService.replacePhone();
        await this.fillPhoneNumber(context, state);
    }

    private async fillPhoneNumber(context: AuthorizationJourneyContext, state: PersistedPhoneState): Promise<void> {
        context.phoneVerificationRequired = true;
        context.phoneNumber = state.phoneNumber;
        context.selectedSmsCountry = state.countryConfig;
        await this.pageActions.typeIntoSelectorSlowly(PHONE_INPUT_SELECTOR, state.phoneNumber);
        actionLog('phone', this.name, `已逐字符填入手机号：${state.phoneNumber}`);
    }
}

class ClickAuthorizationPhoneContinueAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'click-authorization-phone-continue';

    constructor(
        private readonly pageActions: PageActions,
        private readonly phoneNumberAction: FillAuthorizationPhoneNumberAction,
    ) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        while (true) {
            await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"]', 30000);
            actionLog('phone', this.name, '已点击手机号继续按钮。');

            // const htmlPath = createHtmlSnapshotPath('authorization-phone-after-continue');
            // const html = await this.pageActions.getHtml({stableDurationMs: 3000, timeoutMs: 15000});
            // fs.writeFileSync(htmlPath, html, 'utf8');
            // actionLog('phone', this.name, `手机号继续后页面 HTML 已保存：${htmlPath}`);

            const hasPhoneError = await this.waitForPhoneError();
            actionLog('phone', this.name, `手机号错误图标检测结果：${hasPhoneError ? '已出现' : '未出现'} selector=${PHONE_ERROR_ICON_SELECTOR}`);

            if (!hasPhoneError) {
                return;
            }

            actionLog('phone', this.name, '检测到手机号错误提示，取消当前手机号并重新获取。');
            await this.phoneNumberAction.replaceAndFillPhoneNumber(context);
        }
    }

    private async waitForPhoneError(): Promise<boolean> {
        const deadline = Date.now() + PHONE_ERROR_WAIT_TIMEOUT_MS;

        while (Date.now() < deadline) {
            if (await this.pageActions.isSelectorVisible(PHONE_ERROR_ICON_SELECTOR)) {
                return true;
            }
            await sleep(PHONE_ERROR_WAIT_INTERVAL_MS);
        }

        return false;
    }
}

class FillAuthorizationSmsCodeAction implements JourneyAction<AuthorizationJourneyContext> {
    readonly name = 'fill-authorization-sms-code';

    constructor(
        private readonly pageActions: PageActions,
        private readonly phoneResourceService: PhoneResourceService,
        private readonly browserService: BrowserService,
    ) {
    }

    async run(context: AuthorizationJourneyContext): Promise<void> {
        try {
            const code = await this.phoneResourceService.getVerificationCode();
            context.smsVerificationCode = code;
            await this.pageActions.typeIntoSelector('input[name="code"]', code);
            actionLog('sms-otp', this.name, '已将短信验证码填入 input[name="code"]。');
        } catch (error) {
            await saveUsedPhoneCancellationScreenshot(this.browserService, this.phoneResourceService.getCurrentPhoneState(), 'sms-otp', this.name);
            throw error;
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

    constructor(private readonly phoneResourceService?: PhoneResourceService) {
    }

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

        if (context.phoneVerificationRequired && context.smsVerificationCode) {
            await this.phoneResourceService?.markVerificationSucceeded();
            context.phoneVerificationSucceeded = true;
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
    browserService: BrowserService,
): JourneyStep<AuthorizationJourneyContext> {
    const phoneNumberAction = new FillAuthorizationPhoneNumberAction(pageActions, phoneResourceService, browserService);
    return new PageJourneyStep('authorization-phone-page', ['phone'], 'phone', [
        phoneNumberAction,
        new ClickAuthorizationPhoneContinueAction(pageActions, phoneNumberAction),
    ], FLOW_NAME, async () => {
        await retryAuthorizationFromErrorPage(pageActions, 'authorization-phone-page');
    });
}

export function createAuthorizationSmsOtpPageStep(
    pageActions: PageActions,
    phoneResourceService: PhoneResourceService,
    browserService: BrowserService,
): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-sms-otp-page', ['sms-otp'], 'sms-otp', [
        new FillAuthorizationSmsCodeAction(pageActions, phoneResourceService, browserService),
        new ClickAuthorizationSmsContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryAuthorizationFromErrorPage(pageActions, 'authorization-sms-otp-page');
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
    phoneResourceService?: PhoneResourceService,
): JourneyStep<AuthorizationJourneyContext> {
    return new PageJourneyStep('authorization-callback-page', ['callback'], 'callback', [
        new WaitForAuthorizationCallbackAction(callbackTargets, currentUrlProvider, capturedUrlProvider),
        new ParseAuthorizationCallbackAction(oauthService),
        new ExchangeAuthorizationTokenAction(oauthService),
        new SaveAuthorizationResultAction(phoneResourceService),
    ], FLOW_NAME);
}
