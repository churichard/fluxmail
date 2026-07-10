import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EmailError } from '@fluxmail/core';
import { AccountRegistry } from '../src/accounts/registry.js';
import { openDb, oauthTokens } from '../src/storage/db.js';
import { decryptString } from '../src/storage/crypto.js';
import type { FluxmailConfig } from '../src/config.js';

function testConfig(): FluxmailConfig {
  return {
    dataDir: '/tmp',
    dbPath: ':memory:',
    encryptionKey: randomBytes(32),
    port: 8977,
    baseUrl: 'http://localhost:8977',
    oauthPort: 8976,
    oauthHost: '127.0.0.1',
    authMode: 'apikey',
    google: { clientId: 'id', clientSecret: 'secret' },
  };
}

const tokens = { refresh_token: 'rt_secret', access_token: 'at', expiry_date: 123 };

describe('AccountRegistry', () => {
  it('adds an account and stores tokens encrypted', () => {
    const config = testConfig();
    const db = openDb(':memory:');
    const registry = new AccountRegistry(db, config);

    const account = registry.addGmailAccount('me@example.com', tokens);
    expect(account.provider).toBe('gmail');
    expect(account.status).toBe('active');

    const row = db.select().from(oauthTokens).get();
    expect(row?.encryptedTokens).not.toContain('rt_secret');
    expect(JSON.parse(decryptString(config.encryptionKey, row!.encryptedTokens)).refresh_token).toBe('rt_secret');
  });

  it('enforces the free-tier account limit', () => {
    const registry = new AccountRegistry(openDb(':memory:'), testConfig());
    registry.addGmailAccount('one@example.com', tokens);
    try {
      registry.addGmailAccount('two@example.com', tokens);
      expect.unreachable();
    } catch (err) {
      expect((err as EmailError).code).toBe('entitlement_exceeded');
    }
  });

  it('re-adding the same address re-authenticates instead of erroring', () => {
    const registry = new AccountRegistry(openDb(':memory:'), testConfig());
    const first = registry.addGmailAccount('me@example.com', tokens);
    const second = registry.addGmailAccount('me@example.com', { ...tokens, refresh_token: 'rt_new' });
    expect(second.id).toBe(first.id);
    expect(registry.listAccounts()).toHaveLength(1);
  });

  it('resolveAccountId defaults to the sole account and errors when ambiguous or empty', () => {
    const registry = new AccountRegistry(openDb(':memory:'), testConfig());
    expect(() => registry.resolveAccountId()).toThrow(/No email accounts/);
    const account = registry.addGmailAccount('me@example.com', tokens);
    expect(registry.resolveAccountId()).toBe(account.id);
    expect(registry.resolveAccountId(account.id)).toBe(account.id);
    expect(() => registry.resolveAccountId('acct_nope')).toThrow(EmailError);
  });

  it('removeAccount deletes the account', () => {
    const registry = new AccountRegistry(openDb(':memory:'), testConfig());
    const account = registry.addGmailAccount('me@example.com', tokens);
    registry.removeAccount(account.id);
    expect(registry.listAccounts()).toHaveLength(0);
  });
});
