import { EmailError } from '@fluxmail/core';

export interface Entitlements {
  maxAccounts: number;
  maxApiKeys: number;
  tier: 'free' | 'paid';
}

/**
 * v1: free tier only, enforced locally. The v1.1 license client will replace
 * getEntitlements() with lease-backed values from the hosted license server.
 */
export const FREE_TIER: Entitlements = {
  maxAccounts: 1,
  maxApiKeys: 1,
  tier: 'free',
};

export function getEntitlements(): Entitlements {
  return FREE_TIER;
}

export function assertWithinLimit(kind: 'accounts' | 'api keys', current: number, max: number): void {
  if (current >= max) {
    throw new EmailError(
      'entitlement_exceeded',
      `The free tier allows ${max} ${kind.replace(/s$/, '')}${max === 1 ? '' : 's'} (currently ${current}). ` +
        'A paid Fluxmail subscription unlocks more; see the README for details.'
    );
  }
}
