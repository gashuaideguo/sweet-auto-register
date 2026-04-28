export type MailSession = {
    address: string;
    jwt: string;
};

export type MailMessage = {
    raw?: string;
    [key: string]: unknown;
};

export type CreateAddressResult = MailSession;
