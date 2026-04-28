export type IdentityProfile = {
  fullName: string;
  birthDate: string;
};

export type IdentityProvider = {
  generateProfile(): Promise<IdentityProfile>;
};
