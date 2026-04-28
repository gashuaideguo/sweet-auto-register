import { AppRunner } from './app/AppRunner.js';
import { logger } from './shared/logger.js';

function parseAccountCountArg(value: string | undefined): number {
  if (!value) {
    return 1;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[主程序] 无效的账号数量参数：${value}`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const accountCount = parseAccountCountArg(process.argv[2]);
  const appRunner = new AppRunner(accountCount);
  await appRunner.run();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  logger.error(`[主程序] ${message}`);
  process.exitCode = 1;
});
