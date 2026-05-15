import fs from 'node:fs';
import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import type {SyncConfig} from '../../config/types.js';
import {logger} from '../../shared/logger.js';

export class CpaSyncService {
    private readonly localDirectory = path.join(process.cwd(), 'auth', 'cpa');

    constructor(private readonly config: SyncConfig) {
    }

    getLocalDirectory(): string {
        return this.localDirectory;
    }

    validateConfig(): void {
        if (!this.config.enabled) {
            throw new Error('[同步] sync 未启用。');
        }
        if (!this.config.host) {
            throw new Error('[同步] sync.host 缺失。');
        }
        if (!this.config.username) {
            throw new Error('[同步] sync.username 缺失。');
        }
        if (!this.config.password) {
            throw new Error('[同步] sync.password 缺失。');
        }
        if (!this.config.remotePath) {
            throw new Error('[同步] sync.remotePath 缺失。');
        }
    }

    listLocalFiles(): string[] {
        if (!fs.existsSync(this.localDirectory)) {
            return [];
        }

        return fs.readdirSync(this.localDirectory, {withFileTypes: true})
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => path.join(this.localDirectory, entry.name))
            .sort();
    }

    async sync(): Promise<number> {
        this.validateConfig();
        const files = this.listLocalFiles();
        logger.info(`[同步] 已扫描到待上传文件：${files.length}`);

        if (files.length === 0) {
            return 0;
        }

        const client = new SftpClient();
        await client.connect({
            host: this.config.host,
            port: this.config.port,
            username: this.config.username,
            password: this.config.password,
        });

        try {
            await client.mkdir(this.config.remotePath, true);

            for (const filePath of files) {
                const fileName = path.basename(filePath);
                const remotePath = `${this.config.remotePath}/${fileName}`;
                try {
                    await client.put(filePath, remotePath);
                    logger.info(`[同步] 文件上传成功：${fileName}`);
                    fs.unlinkSync(filePath);
                    logger.info(`[同步] 已删除本地文件：${fileName}`);
                } catch (error) {
                    throw new Error(`[同步] 文件上传失败：${fileName}`, {cause: error});
                }
            }
        } finally {
            await client.end();
        }

        return files.length;
    }
}
