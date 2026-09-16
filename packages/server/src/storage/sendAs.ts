import { eq } from 'drizzle-orm';
import type { SendAsIdentity } from '@fluxmail/core';
import { accountSendAs, type FluxmailDb } from './db.js';

export interface ConfiguredSendAsInput {
  email: string;
  name?: string;
}

export function listConfiguredSendAs(db: FluxmailDb, accountId: string): SendAsIdentity[] {
  return db
    .select()
    .from(accountSendAs)
    .where(eq(accountSendAs.accountId, accountId))
    .all()
    .map((row) => ({
      email: row.email,
      ...(row.name ? { name: row.name } : {}),
      isPrimary: false,
      source: 'configured' as const,
    }));
}

export function replaceConfiguredSendAs(db: FluxmailDb, accountId: string, identities: ConfiguredSendAsInput[]): void {
  db.transaction((tx) => {
    tx.delete(accountSendAs).where(eq(accountSendAs.accountId, accountId)).run();
    if (identities.length) {
      tx.insert(accountSendAs)
        .values(identities.map((identity) => ({ accountId, email: identity.email, name: identity.name ?? null })))
        .run();
    }
  });
}
