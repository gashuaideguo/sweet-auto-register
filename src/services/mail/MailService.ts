import type {CreateAddressResult, MailMessage, MailSession} from './types.js';

export interface MailService {

    createAddress(name?: string | null): Promise<CreateAddressResult>;

    useSession(session: MailSession): void;

    listMails(limit?: number, offset?: number): Promise<MailMessage[]>;
}
