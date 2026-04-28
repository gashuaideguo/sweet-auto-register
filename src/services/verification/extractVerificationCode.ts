import type { ExtractVerificationCodeResult } from './types.js';

export function extractVerificationCode(raw = ''): ExtractVerificationCodeResult {
  if (!raw || typeof raw !== 'string') {
    return { code: null, body: '' };
  }

  let body = raw;
  const htmlMatch = raw.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:--[^\r\n]+--|$)/i);
  if (htmlMatch) {
    body = htmlMatch[1];
  } else {
    const parts = raw.split(/\r?\n\r?\n/);
    if (parts.length > 1) {
      body = parts.slice(Math.max(1, parts.length - 3)).join('\n');
    }
  }

  const codePatterns = [
    /(?:code|验证码|verification|verify)[^\d]{0,30}(\d{6})/i,
    /(\d{6})[^\d]{0,30}(?:code|验证码|verification)/i,
    />\s*(\d{6})\s*</,
  ];

  for (const pattern of codePatterns) {
    const match = body.match(pattern);
    if (match) {
      return { code: match[1], body };
    }
  }

  const allSixDigits = body.match(/\b(\d{6})\b/g) || [];
  const filtered = allSixDigits.filter((digits) => !raw.includes(`t=${digits}`) && !raw.includes(`x=${digits}`));

  return {
    code: filtered.length > 0 ? filtered[0] : null,
    body,
  };
}
