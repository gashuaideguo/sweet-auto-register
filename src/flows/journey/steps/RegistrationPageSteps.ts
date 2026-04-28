import crypto from 'node:crypto';
import {logger} from '../../../shared/logger.js';
import type {PageActions} from '../../../pages/types.js';
import type {MailService} from '../../../services/mail/MailService.js';
import {MailVerificationCodeProvider} from '../../../services/verification/MailVerificationCodeProvider.js';
import {PageJourneyStep} from '../PageJourneyStep.js';
import type {JourneyAction, JourneyContext, JourneyStep} from '../types.js';
import {retryRegistrationFromErrorPage} from './retryRegistrationFromErrorPage.js';

const passwordChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FLOW_NAME = '注册';

type RegistrationStageName = 'login' | 'password' | 'mail-otp' | 'profile';

function actionLog(stage: RegistrationStageName, action: string, message: string): void {
    logger.info(`[${FLOW_NAME}][${stage}][${action}] ${message}`);
}

const firstNames = [
    'Liam',
    'Noah',
    'Oliver',
    'Elijah',
    'James',
    'William',
    'Benjamin',
    'Lucas',
    'Henry',
    'Alexander',
    'Olivia',
    'Emma',
    'Ava',
    'Sophia',
    'Isabella',
    'Mia',
    'Charlotte',
    'Amelia',
    'Harper',
    'Evelyn',
];

const lastNames = [
    'Smith',
    'Johnson',
    'Brown',
    'Taylor',
    'Anderson',
    'Thomas',
    'Jackson',
    'White',
    'Harris',
    'Martin',
    'Clark',
    'Lewis',
    'Young',
    'Allen',
    'Hall',
];

function generatePassword(): string {
    const length = 12 + crypto.randomInt(7);
    const bytes = crypto.randomBytes(length);
    let password = '';

    for (const byte of bytes) {
        password += passwordChars[byte % passwordChars.length];
    }

    return password;
}

function randomItem<T>(items: T[]): T {
    return items[crypto.randomInt(items.length)];
}

function generateFullName(): string {
    return `${randomItem(firstNames)} ${randomItem(lastNames)}`;
}

function generateAge(): string {
    return String(crypto.randomInt(20, 41));
}

class FillGeneratedEmailAction implements JourneyAction<JourneyContext> {
    readonly name = 'fill-generated-email';

    constructor(
        private readonly pageActions: PageActions,
        private readonly mailService: MailService,
    ) {
    }

    async run(context: JourneyContext): Promise<void> {
        const session = await this.mailService.createAddress();
        context.mailSession = session;
        actionLog('login', this.name, `已创建邮箱会话：${session.address}`);
        await this.pageActions.typeIntoSelector('input[name="email"]', session.address);
        actionLog('login', this.name, '已将生成邮箱填入 input[name="email"]。');
    }
}

class ClickLoginContinueAction implements JourneyAction<JourneyContext> {
    readonly name = 'click-login-continue';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        await this.pageActions.clickElement('button[type="submit"][data-color="primary"][data-variant="solid"]', 30000);
        actionLog('login', this.name, '已点击邮箱继续按钮。');
    }
}

class FillGeneratedPasswordAction implements JourneyAction<JourneyContext> {
    readonly name = 'fill-generated-password';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(context: JourneyContext): Promise<void> {
        const password = generatePassword();
        context.generatedPassword = password;
        await this.pageActions.typeIntoSelector('input[name="new-password"]', password);
        actionLog('password', this.name, '已将生成密码填入 input[name="new-password"]。');
    }
}

class ClickPasswordContinueAction implements JourneyAction<JourneyContext> {
    readonly name = 'click-password-continue';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"]', 30000);
        actionLog('password', this.name, '已点击密码继续按钮。');
    }
}

class FillMailVerificationCodeAction implements JourneyAction<JourneyContext> {
    readonly name = 'fill-mail-verification-code';

    constructor(
        private readonly pageActions: PageActions,
        private readonly mailService: MailService,
        private readonly options: { intervalMs: number; maxAttempts: number },
    ) {
    }

    async run(context: JourneyContext): Promise<void> {
        if (!context.mailSession) {
            throw new Error('Mail session is missing before verification code step');
        }

        this.mailService.useSession(context.mailSession);
        const provider = new MailVerificationCodeProvider(this.mailService, this.options);
        const code = await provider.getVerificationCode();
        context.mailVerificationCode = code;
        await this.pageActions.typeIntoSelector('input[name="code"]', code);
        actionLog('mail-otp', this.name, '已将邮箱验证码填入 input[name="code"]。');
    }
}

class ClickCodeContinueAction implements JourneyAction<JourneyContext> {
    readonly name = 'click-code-continue';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(): Promise<void> {
        await this.pageActions.clickElement('button[type="submit"][name="intent"][value="validate"]', 30000);
        actionLog('mail-otp', this.name, '已点击邮箱验证码继续按钮。');
    }
}

class FillProfileDetailsAction implements JourneyAction<JourneyContext> {
    readonly name = 'fill-profile-details';

    constructor(private readonly pageActions: PageActions) {
    }

    async run(context: JourneyContext): Promise<void> {
        const fullName = generateFullName();
        const age = generateAge();
        context.generatedFullName = fullName;
        context.generatedAge = age;

        await this.pageActions.typeIntoSelector('input[name="name"]', fullName);
        actionLog('profile', this.name, `已将全名填入 input[name="name"]：${fullName}`);

        await this.pageActions.typeIntoSelector('input[name="age"]', age);
        actionLog('profile', this.name, `已将年龄填入 input[name="age"]：${age}`);

        await this.pageActions.clickElement('button[data-dd-action-name="Continue"][type="submit"]', 30000);
        actionLog('profile', this.name, '已点击完成创建账户按钮。');
    }
}

export function createRegistrationLoginPageStep(
    pageActions: PageActions,
    mailService: MailService,
): JourneyStep<JourneyContext> {
    return new PageJourneyStep('registration-login-page', ['login'], 'login', [
        new FillGeneratedEmailAction(pageActions, mailService),
        new ClickLoginContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryRegistrationFromErrorPage(pageActions, 'registration-login-page');
    });
}

export function createRegistrationPasswordPageStep(pageActions: PageActions): JourneyStep<JourneyContext> {
    return new PageJourneyStep('registration-password-page', ['password'], 'password', [
        new FillGeneratedPasswordAction(pageActions),
        new ClickPasswordContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryRegistrationFromErrorPage(pageActions, 'registration-password-page');
    });
}

export function createRegistrationMailOtpPageStep(
    pageActions: PageActions,
    mailService: MailService,
    options: { intervalMs: number; maxAttempts: number },
): JourneyStep<JourneyContext> {
    return new PageJourneyStep('registration-mail-otp-page', ['mail-otp'], 'mail-otp', [
        new FillMailVerificationCodeAction(pageActions, mailService, options),
        new ClickCodeContinueAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryRegistrationFromErrorPage(pageActions, 'registration-mail-otp-page');
    });
}

export function createRegistrationProfilePageStep(pageActions: PageActions): JourneyStep<JourneyContext> {
    return new PageJourneyStep('registration-profile-page', ['profile'], 'profile', [
        new FillProfileDetailsAction(pageActions),
    ], FLOW_NAME, async () => {
        await retryRegistrationFromErrorPage(pageActions, 'registration-profile-page');
    });
}
