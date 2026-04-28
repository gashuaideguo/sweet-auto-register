import { fetchSmsCodeDemo } from '../flows/demo/fetchSmsCodeDemo.js';
import { logger } from '../shared/logger.js';

async function main(): Promise<void> {
  await fetchSmsCodeDemo();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  logger.error(`[短信验证码演示] ${message}`);
  process.exitCode = 1;
});
