import { loadConfig } from '../../config/loadConfig.js';
import { logger } from '../../shared/logger.js';
import { HttpMailService } from '../../services/mail/HttpMailService.js';
import { MailVerificationCodeProvider } from '../../services/verification/MailVerificationCodeProvider.js';

export async function fetchMailCodeDemo(): Promise<void> {
  const config = loadConfig();
  const mailService = new HttpMailService(config.mail);
  const provider = new MailVerificationCodeProvider(mailService, {
    intervalMs: config.mail.pollIntervalMs,
    maxAttempts: config.mail.maxAttempts,
  });

  const session = await mailService.createAddress();
  logger.info(`[邮箱验证码演示] 已创建邮箱会话：${session.address}`);
  logger.info(`[邮箱验证码演示] 已创建邮箱令牌：${session.jwt}`);

  const code = await provider.getVerificationCode();
  logger.info(`[邮箱验证码演示] 已获取验证码：${code}`);
}
