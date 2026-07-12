import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { gmailConnectionGrants, type FluxmailDb } from './db.js';

export const GMAIL_CONNECTION_GRANT_TTL_MS = 10 * 60 * 1000;
const GMAIL_CONNECTION_SCOPE = 'gmail_connect';
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface GmailConnectionIntent {
  memberId?: string;
  reauthorizeAccountId?: string;
}

export interface GmailConnectionGrant extends GmailConnectionIntent {
  expiresAt: number;
}

export type GmailConnectionClaim =
  | { status: 'claimed'; grant: GmailConnectionGrant }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'used' };

export function gmailConnectionTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createGmailConnectionGrant(
  db: FluxmailDb,
  intent: GmailConnectionIntent = {},
  now = Date.now(),
): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + GMAIL_CONNECTION_GRANT_TTL_MS;

  db.delete(gmailConnectionGrants)
    .where(lt(gmailConnectionGrants.expiresAt, now - RETENTION_MS))
    .run();
  db.insert(gmailConnectionGrants)
    .values({
      tokenHash: gmailConnectionTokenHash(token),
      scope: GMAIL_CONNECTION_SCOPE,
      memberId: intent.memberId ?? null,
      reauthorizeAccountId: intent.reauthorizeAccountId ?? null,
      createdAt: now,
      expiresAt,
      consumedAt: null,
    })
    .run();

  return { token, expiresAt };
}

export function claimGmailConnectionGrant(db: FluxmailDb, token: string, now = Date.now()): GmailConnectionClaim {
  const tokenHash = gmailConnectionTokenHash(token);
  const claimed = db
    .update(gmailConnectionGrants)
    .set({ consumedAt: now })
    .where(
      and(
        eq(gmailConnectionGrants.tokenHash, tokenHash),
        eq(gmailConnectionGrants.scope, GMAIL_CONNECTION_SCOPE),
        isNull(gmailConnectionGrants.consumedAt),
        gt(gmailConnectionGrants.expiresAt, now),
      ),
    )
    .returning()
    .get();

  if (claimed) {
    return {
      status: 'claimed',
      grant: {
        expiresAt: claimed.expiresAt,
        ...(claimed.memberId ? { memberId: claimed.memberId } : {}),
        ...(claimed.reauthorizeAccountId ? { reauthorizeAccountId: claimed.reauthorizeAccountId } : {}),
      },
    };
  }

  const existing = db
    .select()
    .from(gmailConnectionGrants)
    .where(and(eq(gmailConnectionGrants.tokenHash, tokenHash), eq(gmailConnectionGrants.scope, GMAIL_CONNECTION_SCOPE)))
    .get();
  if (!existing) return { status: 'invalid' };
  if (existing.consumedAt !== null) return { status: 'used' };
  return { status: 'expired' };
}
