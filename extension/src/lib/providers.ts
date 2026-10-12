/**
 * The email providers DayDesk can connect to, with the words and links the
 * connect screen needs for each. IDs match the helper's provider registry.
 */

export type ProviderId = 'yahoo' | 'gmail';

export interface ProviderCopy {
  readonly id: ProviderId;
  readonly name: string;
  readonly addressLabel: string;
  readonly addressPlaceholder: string;
  readonly helpUrl: string;
  readonly helpLabel: string;
  /** One or two sentences on getting the app password. */
  readonly howTo: string;
}

export const PROVIDERS: readonly ProviderCopy[] = [
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    addressLabel: 'Yahoo address',
    addressPlaceholder: 'you@yahoo.com',
    helpUrl: 'https://help.yahoo.com/kb/SLN15241.html',
    helpLabel: 'Generate one in Yahoo Account Security',
    howTo: 'Yahoo needs a third-party app password for IMAP — not your account password.',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    addressLabel: 'Gmail address',
    addressPlaceholder: 'you@gmail.com',
    helpUrl: 'https://myaccount.google.com/apppasswords',
    helpLabel: 'Create one in your Google Account',
    howTo:
      'Gmail needs a 16-character app password, which requires 2-Step Verification. Work or school accounts may have app passwords turned off by an admin.',
  },
];

export function providerById(id: string | null | undefined): ProviderCopy | null {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** Guess the provider from an address, so typing "@gmail.com" picks Gmail. */
export function guessProvider(email: string): ProviderId | null {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (/^(gmail|googlemail)\.com$/.test(domain)) return 'gmail';
  if (/^(yahoo|ymail|rocketmail)\.[a-z.]+$/.test(domain)) return 'yahoo';
  return null;
}
