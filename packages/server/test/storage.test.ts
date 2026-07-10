import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EmailError } from '@fluxmail/core';
import { decryptString, encryptString } from '../src/storage/crypto.js';
import { openDb } from '../src/storage/db.js';
import { createApiKey, listApiKeys, revokeApiKey, verifyApiKey } from '../src/storage/apiKeys.js';
import { assertWithinLimit, FREE_TIER } from '../src/licensing/entitlements.js';

describe('crypto', () => {
  const key = randomBytes(32);

  it('round-trips', () => {
    const packed = encryptString(key, 'secret token json');
    expect(packed).not.toContain('secret');
    expect(decryptString(key, packed)).toBe('secret token json');
  });

  it('rejects tampered ciphertext', () => {
    const packed = encryptString(key, 'data');
    const buf = Buffer.from(packed, 'base64');
    buf[buf.length - 1]! ^= 0xff;
    expect(() => decryptString(key, buf.toString('base64'))).toThrow();
  });

  it('rejects the wrong key', () => {
    const packed = encryptString(key, 'data');
    expect(() => decryptString(randomBytes(32), packed)).toThrow();
  });
});

describe('api keys', () => {
  it('creates, verifies, and revokes', () => {
    const db = openDb(':memory:');
    const { key, info } = createApiKey(db, 'test');
    expect(key).toMatch(/^fmk_/);
    expect(verifyApiKey(db, key)).toBe(true);
    expect(verifyApiKey(db, 'fmk_wrong')).toBe(false);
    expect(listApiKeys(db)).toHaveLength(1);
    expect(revokeApiKey(db, info.id)).toBe(true);
    expect(verifyApiKey(db, key)).toBe(false);
  });

  it('enforces the free-tier key limit', () => {
    const db = openDb(':memory:');
    createApiKey(db, 'first');
    expect(() => createApiKey(db, 'second')).toThrow(EmailError);
  });
});

describe('entitlements', () => {
  it('free tier allows 1 account', () => {
    expect(() => assertWithinLimit('accounts', 0, FREE_TIER.maxAccounts)).not.toThrow();
    expect(() => assertWithinLimit('accounts', 1, FREE_TIER.maxAccounts)).toThrow(/free tier/);
  });

  it('throws entitlement_exceeded', () => {
    try {
      assertWithinLimit('accounts', 1, 1);
      expect.unreachable();
    } catch (err) {
      expect((err as EmailError).code).toBe('entitlement_exceeded');
    }
  });
});
