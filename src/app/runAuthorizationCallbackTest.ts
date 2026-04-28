import { testAuthorizationCallback } from '../flows/demo/testAuthorizationCallback.js';
import { logger } from '../shared/logger.js';

async function main(): Promise<void> {
  // const callbackUrl = process.argv[2] ?? '';
  const  callbackUrl = 'http://localhost:1455/auth/callback?code=ac_lzBP4eJM9SeMcGIqPQzbifxfAZNaEKD2HBN_yPm7-eI.i9fvwN0iLrgQc0Wn6iqk5jPmg5zM4SVKZ15IBuT38rw&scope=openid+profile+email+offline_access&state=f185319ef015981ec1fb2ce363e9fff3'
  await testAuthorizationCallback(callbackUrl);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  logger.error(`[授权回调测试] ${message}`);
  process.exitCode = 1;
});
