import {loadConfig} from '../config/loadConfig.js';
import {CpaSyncService} from '../services/sync/CpaSyncService.js';
import {logger} from '../shared/logger.js';

async function main(): Promise<void> {
    const config = loadConfig();
    const service = new CpaSyncService(config.sync);
    logger.info(`[同步] 开始同步 CPA 文件。directory=${service.getLocalDirectory()}`);

    if (!config.sync.enabled) {
        logger.info('[同步] sync 未启用，已跳过。');
        return;
    }

    const uploadedCount = await service.sync();
    if (uploadedCount === 0) {
        logger.info('[同步] 当前没有可上传的 CPA 文件。');
        return;
    }

    logger.info(`[同步] CPA 文件同步完成。count=${uploadedCount}`);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    logger.error(`[同步] ${message}`);
    process.exitCode = 1;
});
