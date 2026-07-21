import { describe, expect, it } from 'vitest';
import { toGraphQuery } from '../src/query.js';

describe('Microsoft Graph query translation', () => {
  it('builds KQL search terms and OData flags', () => {
    expect(
      toGraphQuery({
        text: 'quarterly "report"',
        from: 'alex@example.com',
        to: 'me@example.com',
        subject: 'quarterly forecast',
        after: '2026-01-02',
        before: '2026-02-03',
        unreadOnly: true,
        starredOnly: true,
        hasAttachment: true,
      }),
    ).toEqual({
      search:
        '"quarterly \\"report\\" AND from:\\"alex@example.com\\" AND to:\\"me@example.com\\" AND subject:\\"quarterly forecast\\" AND received>=2026-01-02T00:00:00.000Z AND received<2026-02-03T00:00:00.000Z"',
      filter: "isRead eq false and flag/flagStatus eq 'flagged' and hasAttachments eq true",
    });
  });

  it('keeps KQL operators inside structured field values', () => {
    expect(toGraphQuery({ subject: 'quarterly OR from:other@example.com' })).toEqual({
      search: '"subject:\\"quarterly OR from:other@example.com\\""',
    });
  });

  it('passes raw Graph KQL through and rejects an ambiguous text query', () => {
    expect(toGraphQuery({ rawProviderQuery: 'from:alex AND subject:status' })).toEqual({
      search: '"from:alex AND subject:status"',
    });
    expect(() => toGraphQuery({ text: 'status', rawProviderQuery: 'from:alex' })).toThrow(/cannot be combined/);
  });

  it('rejects invalid dates', () => {
    expect(() => toGraphQuery({ after: 'not-a-date' })).toThrow(/after must be a valid ISO date/);
  });

  it('preserves time precision in KQL date filters', () => {
    expect(toGraphQuery({ after: '2026-07-20T10:00:00.000Z' })).toEqual({
      search: '"received>=2026-07-20T10:00:00.000Z"',
    });
  });

  it('compiles structured KQL with boolean precedence and attachment fields', () => {
    expect(
      toGraphQuery({
        expression: {
          type: 'and',
          operands: [
            {
              type: 'or',
              operands: [
                { type: 'field', field: 'from', value: 'amy@example.com' },
                { type: 'field', field: 'to', value: 'david@example.com' },
              ],
            },
            { type: 'not', operand: { type: 'field', field: 'filename', value: 'draft.docx' } },
          ],
        },
      }),
    ).toEqual({
      search: '"((from:\\"amy@example.com\\" OR to:\\"david@example.com\\") AND NOT (attachment:\\"draft.docx\\"))"',
    });
  });

  it('supports both positive and negative top-level flags', () => {
    expect(toGraphQuery({ read: true, starred: false, hasAttachment: false })).toEqual({
      filter: "isRead eq true and flag/flagStatus ne 'flagged' and hasAttachments eq false",
    });
  });
});
