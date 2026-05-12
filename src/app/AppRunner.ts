import fs from 'node:fs';
import path from 'node:path';
import {loadConfig} from '../config/loadConfig.js';
import {authorizationFlow, type AuthorizationAccount} from '../flows/authorizationFlow.js';
import {registerFlow} from '../flows/registerFlow.js';
import type {RegistrationRecord} from '../flows/types.js';
import {logger} from '../shared/logger.js';

function isSmsVerificationTimeout(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('SMS verification code timeout');
}

function getAuthorizationAccounts(limit: number, excludeFilePaths = new Set<string>()): AuthorizationAccount[] {
    const directory = path.join(process.cwd(), 'auth', 'register');

    if (!fs.existsSync(directory)) {
        return [];
    }

    return fs.readdirSync(directory, {withFileTypes: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => {
            const filePath = path.join(directory, entry.name);
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw) as Partial<RegistrationRecord>;

            return {
                email: String(parsed.email ?? ''),
                password: String(parsed.password ?? ''),
                name: String(parsed.name ?? ''),
                age: String(parsed.age ?? ''),
                jwt: String(parsed.jwt ?? ''),
                verify_code: String(parsed.verify_code ?? ''),
                filePath,
            };
        })
        .filter((account) => !excludeFilePaths.has(account.filePath))
        .slice(0, limit);
}

export class AppRunner {
    constructor(private readonly accountCount = 1) {
    }

    async run(): Promise<void> {
        const config = loadConfig();
        logger.info(`[应用] 配置加载完成，起始地址：${config.startUrl} targetCount=${this.accountCount}`);

        const handledAccountFiles = new Set<string>();

        for (let index = 1; index <= this.accountCount; index += 1) {
            const [existingAccount] = getAuthorizationAccounts(1, handledAccountFiles);

            if (existingAccount) {
                logger.info(`[应用] 发现已注册账号，直接执行第 ${index}/${this.accountCount} 个授权流程。email=${existingAccount.email}`);
                await this.runAuthorization(config, existingAccount);
                handledAccountFiles.add(existingAccount.filePath);
            } else {
                logger.info(`[应用] 未发现可授权账号，开始执行第 ${index}/${this.accountCount} 个注册流程。`);
                await this.runRegistration(config);
                const [registeredAccount] = getAuthorizationAccounts(1, handledAccountFiles);

                if (!registeredAccount) {
                    throw new Error(`[应用] 注册后未找到可授权账号。index=${index} target=${this.accountCount}`);
                }

                logger.info(`[应用] 注册完成，开始执行第 ${index}/${this.accountCount} 个授权流程。email=${registeredAccount.email}`);
                await this.runAuthorization(config, registeredAccount);
                handledAccountFiles.add(registeredAccount.filePath);
            }
        }
    }

    private async runRegistration(config: ReturnType<typeof loadConfig>): Promise<void> {
        logger.info(`[应用] 开始执行注册流程`);
        await registerFlow(config);
    }

    private async runAuthorization(config: ReturnType<typeof loadConfig>, account: AuthorizationAccount): Promise<void> {
        while (true) {
            try {
                logger.info(`[应用] 开始执行授权账号。email=${account.email} file=${account.filePath}`);
                await authorizationFlow(config, account);
                return;
            } catch (error) {
                if (!isSmsVerificationTimeout(error)) {
                    throw error;
                }

                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`[应用] 当前账号短信验证码超时，准备重新授权当前账号。email=${account.email} error=${message}`);
            }
        }
    }
}
