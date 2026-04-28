export type VerificationCodeProvider = {
  getVerificationCode(): Promise<string>;
};
