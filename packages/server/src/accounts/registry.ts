import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import { EmailError, type Account, type EmailProvider, type Provider } from '@fluxmail/core';
import { GmailProvider, GMAIL_CAPABILITIES } from '@fluxmail/provider-gmail';
import type { FluxmailConfig } from '../config.js';
import { accounts, oauthTokens, type FluxmailDb } from '../storage/db.js';
import { decryptString, encryptString } from '../storage/crypto.js';
import { assertWithinLimit, getEntitlements } from '../licensing/entitlements.js';
import { requireGoogleConfig } from './googleAuth.js';

export class AccountRegistry {
  private readonly providers = new Map<string, EmailProvider>();

  constructor(
    private readonly db: FluxmailDb,
    private readonly config: FluxmailConfig
  ) {}

  listAccounts(): Account[] {
    return this.db
      .select()
      .from(accounts)
      .all()
      .map((row) => ({
        id: row.id,
        provider: row.provider as Provider,
        email: row.email,
        ...(row.displayName ? { displayName: row.displayName } : {}),
        status: row.status as Account['status'],
        capabilities: GMAIL_CAPABILITIES,
      }));
  }

  getAccount(accountId: string): Account {
    const account = this.listAccounts().find((a) => a.id === accountId);
    if (!account) throw new EmailError('not_found', `No account with id "${accountId}"`);
    return account;
  }

  /** Resolve an account id, defaulting to the sole account when only one exists. */
  resolveAccountId(accountId?: string): string {
    if (accountId) return this.getAccount(accountId).id;
    const all = this.listAccounts();
    if (all.length === 0) {
      throw new EmailError(
        'invalid_request',
        'No email accounts are connected yet. Run "fluxmail accounts add gmail" to connect one.'
      );
    }
    if (all.length > 1) {
      throw new EmailError(
        'invalid_request',
        `Multiple accounts are connected; specify accountId. Available: ${all
          .map((a) => `${a.id} (${a.email})`)
          .join(', ')}`
      );
    }
    return all[0]!.id;
  }

  getProvider(accountId: string): EmailProvider {
    const cached = this.providers.get(accountId);
    if (cached) return cached;

    const account = this.getAccount(accountId);
    if (account.provider !== 'gmail') {
      throw new EmailError('unsupported_capability', `Provider "${account.provider}" is not supported yet`);
    }
    const provider = this.buildGmailProvider(accountId, account.email, account.displayName);
    this.providers.set(accountId, provider);
    return provider;
  }

  private loadTokens(accountId: string): Credentials {
    const row = this.db.select().from(oauthTokens).where(eq(oauthTokens.accountId, accountId)).get();
    if (!row) throw new EmailError('auth_expired', `No stored credentials for account ${accountId}`);
    return JSON.parse(decryptString(this.config.encryptionKey, row.encryptedTokens)) as Credentials;
  }

  private saveTokens(accountId: string, tokens: Credentials): void {
    const encrypted = encryptString(this.config.encryptionKey, JSON.stringify(tokens));
    this.db
      .insert(oauthTokens)
      .values({ accountId, encryptedTokens: encrypted, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: oauthTokens.accountId,
        set: { encryptedTokens: encrypted, updatedAt: Date.now() },
      })
      .run();
  }

  private buildGmailProvider(accountId: string, email: string, displayName?: string): EmailProvider {
    const { clientId, clientSecret } = requireGoogleConfig(this.config);
    const auth = new OAuth2Client({ clientId, clientSecret });
    const stored = this.loadTokens(accountId);
    auth.setCredentials(stored);
    // google-auth-library refreshes access tokens transparently; persist them so
    // restarts don't need a refresh round-trip (and rotated refresh tokens survive).
    auth.on('tokens', (fresh) => {
      this.saveTokens(accountId, { ...this.loadTokens(accountId), ...fresh });
    });
    return new GmailProvider({ accountId, email, ...(displayName ? { displayName } : {}), auth });
  }

  addGmailAccount(email: string, tokens: Credentials, displayName?: string): Account {
    const existing = this.db.select().from(accounts).all();
    const duplicate = existing.find((a) => a.provider === 'gmail' && a.email === email);
    if (duplicate) {
      // Re-authenticating an existing account: refresh tokens, clear error state.
      this.saveTokens(duplicate.id, tokens);
      this.db
        .update(accounts)
        .set({ status: 'active', ...(displayName ? { displayName } : {}) })
        .where(eq(accounts.id, duplicate.id))
        .run();
      this.providers.delete(duplicate.id);
      return this.getAccount(duplicate.id);
    }

    assertWithinLimit('accounts', existing.length, getEntitlements().maxAccounts);
    const id = `acct_${randomBytes(6).toString('hex')}`;
    this.db
      .insert(accounts)
      .values({
        id,
        provider: 'gmail',
        email,
        displayName: displayName ?? null,
        status: 'active',
        createdAt: Date.now(),
      })
      .run();
    this.saveTokens(id, tokens);
    return this.getAccount(id);
  }

  removeAccount(accountId: string): void {
    this.getAccount(accountId);
    this.db.delete(accounts).where(eq(accounts.id, accountId)).run();
    this.providers.delete(accountId);
  }

  markStatus(accountId: string, status: Account['status']): void {
    this.db.update(accounts).set({ status }).where(eq(accounts.id, accountId)).run();
  }
}
