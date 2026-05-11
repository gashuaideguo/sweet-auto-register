import fs from 'node:fs';
import path from 'node:path';
import {loadConfig} from '../config/loadConfig.js';
import {authorizationFlow, type AuthorizationAccount} from '../flows/authorizationFlow.js';
import {registerFlow} from '../flows/registerFlow.js';
import type {RegistrationRecord} from '../flows/types.js';
import {logger} from '../shared/logger.js';
import {sleep} from '../shared/sleep.js';

function isSmsVerificationTimeout(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('SMS verification code timeout');
}

function getAuthorizationAccounts(limit: number): AuthorizationAccount[] {
    const directory = path.join(process.cwd(), 'auth', 'register');

    if (!fs.existsSync(directory)) {
        return [];
    }

    return fs.readdirSync(directory, {withFileTypes: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, limit)
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
        });
}

export class AppRunner {
    constructor(private readonly accountCount = 1) {
    }

    async run(): Promise<void> {
        const config = loadConfig();
        logger.info(`[应用] 配置加载完成，起始地址：${config.startUrl} targetCount=${this.accountCount}`);

        const existingAccounts = getAuthorizationAccounts(this.accountCount);
        const missingCount = Math.max(0, this.accountCount - existingAccounts.length);
        logger.info(`[应用] 目标账号数量：${this.accountCount}，当前可授权账号数量：${existingAccounts.length}，需要补充注册数量：${missingCount}`);

        for (let index = 1; index <= missingCount; index += 1) {
            logger.info(`[应用] 开始补充注册第 ${index}/${missingCount} 个账号。`);
            await this.runRegistration(config);
        }

        const accounts = getAuthorizationAccounts(this.accountCount);
        logger.info(`[应用] 注册账号准备完成，可执行授权账号数量：${accounts.length}/${this.accountCount}`);

        if (accounts.length < this.accountCount) {
            throw new Error(`[应用] 补充注册后账号数量仍不足。target=${this.accountCount} available=${accounts.length}`);
        }

        for (const [index, account] of accounts.entries()) {
            logger.info(`[应用] 开始执行第 ${index + 1}/${this.accountCount} 个账号授权流程。`);
            let authorized = false;
            try {
                await this.runAuthorization(config, account);
                authorized = true;
            } catch (error) {
                if (!isSmsVerificationTimeout(error)) {
                    throw error;
                }

                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`[应用] 当前账号短信验证码超时，已结束本次授权并继续下一个账号。email=${account.email} error=${message}`);
            }

            if (authorized && index < accounts.length - 1) {
                logger.info('[应用] 当前账号授权完成，等待 3 分钟后继续下一个账号。');
                await sleep(3 * 60 * 1000);
            }
        }
    }

    private async runRegistration(config: ReturnType<typeof loadConfig>): Promise<void> {
        logger.info(`[应用] 开始执行注册流程`);
        await registerFlow(config);
    }

    private async runAuthorization(config: ReturnType<typeof loadConfig>, account: AuthorizationAccount): Promise<void> {
        logger.info(`[应用] 开始执行授权账号。email=${account.email} file=${account.filePath}`);
        await authorizationFlow(config, account);
    }
}
