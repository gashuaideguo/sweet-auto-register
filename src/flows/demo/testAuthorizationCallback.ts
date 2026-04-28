import { loadConfig } from '../../config/loadConfig.js';
import { logger } from '../../shared/logger.js';
import { OAuthService } from '../../services/oauth/OAuthService.js';

export async function testAuthorizationCallback(callbackUrl: string): Promise<void> {
  if (!callbackUrl) {
    throw new Error('[授权回调测试] 缺少 callback URL 参数。');
  }

  const config = loadConfig();
  const oauthService = OAuthService.fromAppConfig(config);
  const callbackParams = oauthService.extractCallbackParams(callbackUrl);
  if (!callbackParams) {
    throw new Error('[授权回调测试] callback 参数解析失败，或 state 校验未通过。');
  }

  logger.info(`[授权回调测试] 已解析 callback。code=${callbackParams.code ?? '<empty>'} state=${callbackParams.state ?? '<empty>'}`);

  if (callbackParams.error) {
    throw new Error(`[授权回调测试] OAuth 回调返回错误：${callbackParams.error} ${callbackParams.errorDescription ?? ''}`.trim());
  }

  if (!callbackParams.code) {
    throw new Error('[授权回调测试] callback 中缺少 code。');
  }

  const tokenResponse = await oauthService.exchangeToken(callbackParams.code);
  logger.info(`[授权回调测试] token 交换成功。access_token=${String(tokenResponse.access_token ?? '')} account_id=${String(tokenResponse.account_id ?? '')}`);
  logger.info(`[授权回调测试] token 响应：${JSON.stringify(tokenResponse)}`);
}
