import { fetchMailCodeDemo } from '../flows/demo/fetchMailCodeDemo.js';
import { logger } from '../shared/logger.js';

async function main(): Promise<void> {
  await fetchMailCodeDemo();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  logger.error(`[邮箱验证码演示] ${message}`);
  process.exitCode = 1;
});
