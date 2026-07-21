import { describe, expect, it } from 'vitest';
import { toGmailQuery } from '../src/query.js';

const noLabels = () => null;

describe('toGmailQuery', () => {
  it('maps folder roles to system labels', () => {
    expect(toGmailQuery({ folder: 'inbox' }, noLabels)).toEqual({ labelIds: ['INBOX'] });
    expect(toGmailQuery({ folder: 'sent' }, noLabels)).toEqual({ labelIds: ['SENT'] });
  });

  it('includes spam/trash when targeting those folders', () => {
    expect(toGmailQuery({ folder: 'trash' }, noLabels)).toEqual({
      labelIds: ['TRASH'],
      includeSpamTrash: true,
    });
  });

  it("uses Gmail's archive search operator", () => {
    const q = toGmailQuery({ folder: 'archive' }, noLabels);
    expect(q.q).toBe('in:archive');
    expect(q.labelIds).toBeUndefined();
  });

  it('uses Gmail default scope when targeting all mail', () => {
    expect(toGmailQuery({ folder: 'all' }, noLabels)).toEqual({});
  });

  it('resolves user labels through the resolver', () => {
    expect(toGmailQuery({ folder: 'Projects' }, () => 'Label_42')).toEqual({ labelIds: ['Label_42'] });
  });

  it('builds q from filters', () => {
    const q = toGmailQuery(
      {
        text: 'quarterly report',
        from: 'ann@example.com',
        unreadOnly: true,
        hasAttachment: true,
        after: '2026-01-01T00:00:00.000Z',
      },
      noLabels,
    );
    expect(q.q).toContain('quarterly report');
    expect(q.q).toContain('from:ann@example.com');
    expect(q.q).toContain('is:unread');
    expect(q.q).toContain('has:attachment');
    expect(q.q).toMatch(/after:\d{10}/);
  });

  it('quotes values with spaces', () => {
    const q = toGmailQuery({ subject: 'hello world' }, noLabels);
    expect(q.q).toBe('subject:"hello world"');
  });

  it('passes rawProviderQuery through verbatim', () => {
    const q = toGmailQuery({ rawProviderQuery: 'in:anywhere label:foo' }, noLabels);
    expect(q.q).toBe('in:anywhere label:foo');
  });

  it('rejects invalid date filters before calling Gmail', () => {
    expect(() => toGmailQuery({ after: 'not-a-date' }, noLabels)).toThrow(/valid ISO date/);
  });

  it('compiles structured boolean expressions without flattening them', () => {
    expect(
      toGmailQuery(
        {
          expression: {
            type: 'and',
            operands: [
              {
                type: 'or',
                operands: [
                  { type: 'field', field: 'from', value: 'amy@example.com' },
                  { type: 'field', field: 'from', value: 'david@example.com' },
                ],
              },
              {
                type: 'not',
                operand: { type: 'field', field: 'subject', value: 'status report' },
              },
              { type: 'field', field: 'filename', value: 'plan.pdf' },
            ],
          },
        },
        noLabels,
      ).q,
    ).toBe('{from:amy@example.com from:david@example.com} -subject:"status report" filename:plan.pdf');
  });

  it('resolves structured labels without leaking desktop folder ids', () => {
    expect(
      toGmailQuery({ expression: { type: 'field', field: 'label', value: 'Projects' } }, (value) =>
        value === 'Projects' ? 'Label_42' : null,
      ).q,
    ).toBe('label:Label_42');
  });

  it('preserves exact text and quotes Gmail grouping characters in field values', () => {
    expect(toGmailQuery({ expression: { type: 'text', value: 'foo(bar)', exact: true } }, noLabels).q).toBe(
      '"foo(bar)"',
    );
    expect(toGmailQuery({ expression: { type: 'field', field: 'label', value: 'Ops(Q3)' } }, noLabels).q).toBe(
      'label:"Ops(Q3)"',
    );
  });

  it('compiles folder aliases and widens the API scope for positive spam/trash expressions', () => {
    expect(
      toGmailQuery(
        {
          expression: {
            type: 'or',
            operands: [
              { type: 'field', field: 'folder', value: 'trash' },
              { type: 'field', field: 'folder', value: 'starred' },
              { type: 'field', field: 'folder', value: 'archive' },
            ],
          },
        },
        noLabels,
      ),
    ).toEqual({
      q: '{in:trash is:starred in:archive}',
      includeSpamTrash: true,
    });
    expect(
      toGmailQuery(
        { expression: { type: 'not', operand: { type: 'field', field: 'folder', value: 'spam' } } },
        noLabels,
      ).includeSpamTrash,
    ).toBeUndefined();
  });
});
