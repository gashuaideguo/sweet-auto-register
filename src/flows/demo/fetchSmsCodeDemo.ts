import {loadConfig} from '../../config/loadConfig.js';
import {logger} from '../../shared/logger.js';
import {createSmsService} from '../../services/sms/createSmsService.js';
import {SmsVerificationCodeProvider} from '../../services/verification/SmsVerificationCodeProvider.js';

export async function fetchSmsCodeDemo(): Promise<void> {
    const config = loadConfig();
    const defaultCountry = config.sms.provider === '5sim'
        ? config.sms.fiveSim.countries[0]
        : config.sms.heroSms.countries[0];
    if (!defaultCountry) {
        throw new Error('provider countries[0] is required for fetchSmsCodeDemo');
    }
    if (config.sms.provider === 'hero-sms' && !config.sms.heroSms.apiKey) {
        throw new Error('sms.heroSms.apiKey is required for fetchSmsCodeDemo');
    }
    if (config.sms.provider === '5sim' && !config.sms.fiveSim.apiKey) {
        throw new Error('sms.fiveSim.apiKey is required for fetchSmsCodeDemo');
    }

    const smsService = createSmsService(config.sms, defaultCountry);
    const provider = new SmsVerificationCodeProvider(smsService, {
        intervalMs: config.sms.pollIntervalMs,
        maxAttempts: config.sms.maxAttempts,
    });

    try {
        const phoneNumber = await smsService.getPhoneNumber();
        logger.info(`[短信验证码演示] 已获取手机号：${phoneNumber}`);

        await smsService.markReady();
        logger.info('[短信验证码演示] 已将激活记录标记为就绪。');

        const code = await provider.getVerificationCode();
        logger.info(`[短信验证码演示] 已获取验证码：${code}`);
    } catch (error) {
        try {
            await smsService.cancel();
            logger.info('[短信验证码演示] 已取消激活记录。');
        } catch (cancelError) {
            const message = cancelError instanceof Error ? cancelError.message : String(cancelError);
            logger.warn(`[短信验证码演示] 取消激活记录失败：${message}`);
        }
        throw error;
    }
}
