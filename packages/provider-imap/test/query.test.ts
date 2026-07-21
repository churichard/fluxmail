import { describe, expect, it } from 'vitest';
import { toImapSearch } from '../src/query.js';

describe('toImapSearch', () => {
  it('maps structured filters', () => {
    expect(
      toImapSearch(
        { text: 'report', from: 'ann@example.com', unreadOnly: true, starredOnly: true, after: '2026-01-01' },
        false,
      ),
    ).toMatchObject({ text: 'report', from: 'ann@example.com', seen: false, flagged: true });
  });

  it('only permits raw queries on Gmail IMAP', () => {
    expect(() => toImapSearch({ rawProviderQuery: 'has:attachment' }, false)).toThrow(/Gmail raw search/);
    expect(toImapSearch({ rawProviderQuery: 'has:attachment' }, true)).toMatchObject({ gmraw: 'has:attachment' });
  });

  it('rejects invalid dates', () => {
    expect(() => toImapSearch({ after: 'yesterday' }, false)).toThrow(/ISO date/);
  });

  it('requires WITHIN for precise dates inside boolean expressions', () => {
    const query = {
      expression: {
        type: 'field' as const,
        field: 'after' as const,
        value: '2026-07-20T10:00:00.000Z',
      },
    };
    expect(() => toImapSearch(query, false, false)).toThrow(/WITHIN/);
    expect(toImapSearch(query, false, true)).toMatchObject({
      since: new Date('2026-07-20T10:00:00.000Z'),
    });
  });

  it('preserves boolean grouping and repeated fields with IMAP OR/NOT nodes', () => {
    expect(
      toImapSearch(
        {
          expression: {
            type: 'and',
            operands: [
              { type: 'field', field: 'from', value: 'amy@example.com' },
              { type: 'field', field: 'from', value: 'david@example.com' },
            ],
          },
        },
        false,
      ),
    ).toEqual({
      all: true,
      not: {
        or: [{ not: { from: 'amy@example.com' } }, { not: { from: 'david@example.com' } }],
      },
    });
  });

  it('uses Gmail raw leaves for attachment and filename expressions when available', () => {
    expect(
      toImapSearch(
        {
          expression: {
            type: 'or',
            operands: [
              { type: 'field', field: 'has_attachment', value: true },
              { type: 'field', field: 'filename', value: 'road map.pdf' },
            ],
          },
        },
        true,
      ),
    ).toMatchObject({
      or: [{ gmraw: 'has:attachment' }, { gmraw: 'filename:"road map.pdf"' }],
    });
  });

  it('quotes Gmail raw field values that contain grouping characters', () => {
    expect(toImapSearch({ expression: { type: 'field', field: 'label', value: 'Ops(Q3)' } }, true)).toMatchObject({
      gmraw: 'label:"Ops(Q3)"',
    });
  });

  it('rejects filename expressions on generic IMAP instead of weakening the query', () => {
    expect(() =>
      toImapSearch({ expression: { type: 'field', field: 'filename', value: 'report.pdf' } }, false),
    ).toThrow(/Gmail-compatible/);
  });
});
