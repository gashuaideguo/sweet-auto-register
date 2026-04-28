import type {RegistrationStage} from '../types.js';

export function resolveRegistrationStage(url: string): RegistrationStage | null {
    if (url.includes('/create-account/password')) {
        return 'password';
    }
    if (url.includes('/email-verification')) {
        return 'mail-otp';
    }
    if (url.includes('/about-you')) {
        return 'profile';
    }
    if (url.includes('/welcome')) {
        return 'done';
    }
    if (url.includes('/login')) {
        return 'login';
    }
    return null;
}
