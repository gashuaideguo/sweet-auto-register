import { logger } from '../shared/logger.js';
import { WebServer } from './WebServer.js';

function parsePort(): number {
  const raw = process.argv[2] ?? process.env.WEB_PORT ?? '3000';
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid web port: ${raw}`);
  }

  return port;
}

async function main(): Promise<void> {
  const server = new WebServer({ port: parsePort() });
  await server.start();
  logger.info(`[Web] Management page listening on ${server.getUrl()}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`[Web] 启动失败：${message}`);
  process.exitCode = 1;
});
