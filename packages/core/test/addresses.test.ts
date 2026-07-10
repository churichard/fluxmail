import { describe, expect, it } from 'vitest';
import { parseAddressList, parseSingleAddress } from '../src/index.js';

describe('parseAddressList', () => {
  it('parses a mixed list', () => {
    expect(parseAddressList('Ann Smith <ann@example.com>, bob@example.com')).toEqual([
      { name: 'Ann Smith', email: 'ann@example.com' },
      { email: 'bob@example.com' },
    ]);
  });

  it('handles commas inside quoted names', () => {
    expect(parseAddressList('"Smith, Ann" <ann@example.com>, bob@example.com')).toEqual([
      { name: 'Smith, Ann', email: 'ann@example.com' },
      { email: 'bob@example.com' },
    ]);
  });

  it('returns empty for undefined/empty', () => {
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList('')).toEqual([]);
  });
});

describe('parseSingleAddress', () => {
  it('parses angle form', () => {
    expect(parseSingleAddress('Ann <ann@example.com>')).toEqual({ name: 'Ann', email: 'ann@example.com' });
  });
  it('parses bare address', () => {
    expect(parseSingleAddress('ann@example.com')).toEqual({ email: 'ann@example.com' });
  });
  it('rejects garbage', () => {
    expect(parseSingleAddress('not an address')).toBeNull();
  });
});
