import fs from 'node:fs';
import path from 'node:path';
import {loadConfig} from '../config/loadConfig.js';
import {authorizationFlow, type AuthorizationAccount} from '../flows/authorizationFlow.js';
import {registerFlow} from '../flows/registerFlow.js';
import type {RegistrationRecord} from '../flows/types.js';
import {logger} from '../shared/logger.js';

function getAuthorizationAccounts(limit: number): AuthorizationAccount[] {
    const directory = path.join(process.cwd(), 'auth', 'register');

    if (!fs.existsSync(directory)) {
        return [];
    }

    return fs.readdirSync(directory, {withFileTypes: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
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

        for (let index = 1; index <= this.accountCount; index += 1) {
            logger.info(`[应用] 开始执行第 ${index}/${this.accountCount} 个账号流程。`);
            await this.runRegistration(config);
            // await this.runAuthorization(config);
        }
    }

    private async runRegistration(config: ReturnType<typeof loadConfig>): Promise<void> {
        logger.info(`[应用] 开始执行注册流程`);
        await registerFlow(config);
    }

    private async runAuthorization(config: ReturnType<typeof loadConfig>): Promise<void> {
        const accounts = getAuthorizationAccounts(1);
        logger.info(`[应用] 已读取授权账号数量：${accounts.length}`);

        const account = accounts[0];
        if (!account) {
            logger.info('[应用] 当前没有可执行授权的账号，已跳过。');
            return;
        }
        logger.info(`[应用] 开始执行授权账号。email=${account.email} file=${account.filePath}`);
        await authorizationFlow(config, account);
    }
}
