import type {AuthorizationJourneyContext, AuthorizationStage} from './types.js';

function matchesCallback(url: string, redirectUri: string): boolean {
    if (!url) {
        return false;
    }

    try {
        const redirect = new URL(redirectUri);
        const redirectHost = redirect.host;
        return url.includes(redirectHost) || url.includes('/auth/callback');
    } catch {
        return url.includes('/auth/callback') || url.includes('localhost:');
    }
}

export function resolveAuthorizationStage(
    url: string,
    context: AuthorizationJourneyContext,
): AuthorizationStage | null {
    if (context.tokenResponse) {
        return 'done';
    }

    if (matchesCallback(context.capturedCallbackUrl ?? '', context.redirectUri) || matchesCallback(url, context.redirectUri)) {
        return 'callback';
    }

    if (url.includes('/sign-in-with-chatgpt/codex/organization')) {
        return 'organization';
    }

    if (url.includes('/sign-in-with-chatgpt/codex/consent')) {
        return 'consent';
    }

    if (url.includes('add-phone')) {
        return 'phone';
    }

    if (url.includes('verify-phone') || url.includes('phone-verification') || url.includes('sms')) {
        return 'sms-otp';
    }

    if (url.includes('/email-verification')) {
        return 'mail-otp';
    }

    if (url.includes('/log-in/password')) {
        return 'password';
    }

    if (context.phoneVerificationRequired && context.phoneNumber) {
        return 'sms-otp';
    }

    if (url.includes('/log-in')) {
        return 'login';
    }

    return null;
}
