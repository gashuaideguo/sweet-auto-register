import type { VerificationCodeProvider } from '../contracts/VerificationCodeProvider.js';
import type { MailService } from '../mail/MailService.js';
import { extractVerificationCode } from './extractVerificationCode.js';
import { logger } from '../../shared/logger.js';
import { sleep } from '../../shared/sleep.js';

export class MailVerificationCodeProvider implements VerificationCodeProvider {
  constructor(
    private readonly mailService: MailService,
    private readonly options: { intervalMs: number; maxAttempts: number },
  ) {}

  async getVerificationCode(): Promise<string> {
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      logger.info(`[邮箱验证码] 正在轮询当前会话。attempt=${attempt}/${this.options.maxAttempts}`);

      try {
        const mails = await this.mailService.listMails(5, 0);
        if (Array.isArray(mails) && mails.length > 0) {
          const result = extractVerificationCode(mails[0]?.raw || '');
          if (result.code) {
            logger.info(`[邮箱验证码] 已获取验证码：${result.code}`);
            return result.code;
          }
          logger.info('[邮箱验证码] 已收到邮件，但未提取到验证码。');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[邮箱验证码] 查询当前会话失败：${message}`);
      }

      await sleep(this.options.intervalMs);
    }

    throw new Error('Mail verification code timeout for current-session');
  }
}
