import { describe, expect, it } from 'vitest';
import { parseEmailSearch } from '../src/search.js';

describe('parseEmailSearch', () => {
  it('preserves boolean precedence and grouping', () => {
    expect(parseEmailSearch('from:amy OR (from:david AND NOT subject:"status report")')).toEqual({
      type: 'or',
      operands: [
        { type: 'field', field: 'from', value: 'amy' },
        {
          type: 'and',
          operands: [
            { type: 'field', field: 'from', value: 'david' },
            {
              type: 'not',
              operand: { type: 'field', field: 'subject', value: 'status report' },
            },
          ],
        },
      ],
    });
  });

  it('uses implicit AND and keeps repeated fields', () => {
    expect(parseEmailSearch('from:amy from:david "road map"')).toEqual({
      type: 'and',
      operands: [
        { type: 'field', field: 'from', value: 'amy' },
        { type: 'field', field: 'from', value: 'david' },
        { type: 'text', value: 'road map', exact: true },
      ],
    });
  });

  it('continues parsing after an unmatched closing parenthesis', () => {
    expect(parseEmailSearch('from:amy) from:bob')).toEqual({
      type: 'and',
      operands: [
        { type: 'field', field: 'from', value: 'amy' },
        { type: 'field', field: 'from', value: 'bob' },
      ],
    });
  });

  it('parses status, attachment, folder, label, recipient, and account operators', () => {
    expect(
      parseEmailSearch(
        'is:unread has:attachment in:inbox label:work cc:a@example.com bcc:b@example.com account:personal',
      ),
    ).toMatchObject({
      type: 'and',
      operands: [
        { field: 'read', value: false },
        { field: 'has_attachment', value: true },
        { field: 'folder', value: 'inbox' },
        { field: 'label', value: 'work' },
        { field: 'cc', value: 'a@example.com' },
        { field: 'bcc', value: 'b@example.com' },
        { field: 'account', value: 'personal' },
      ],
    });
  });

  it('parses aliases and relative dates against a supplied clock', () => {
    const now = new Date('2026-07-20T12:00:00.000Z');
    expect(parseEmailSearch('newer_than:2d older_than:1m', now)).toEqual({
      type: 'and',
      operands: [
        { type: 'field', field: 'after', value: '2026-07-18T12:00:00.000Z' },
        { type: 'field', field: 'before', value: '2026-06-20T12:00:00.000Z' },
      ],
    });
  });

  it('clamps calendar-relative dates at month and year boundaries', () => {
    expect(parseEmailSearch('after:1m', new Date('2026-03-31T12:00:00.000Z'))).toEqual({
      type: 'field',
      field: 'after',
      value: '2026-02-28T12:00:00.000Z',
    });
    expect(parseEmailSearch('before:1y', new Date('2024-02-29T12:00:00.000Z'))).toEqual({
      type: 'field',
      field: 'before',
      value: '2023-02-28T12:00:00.000Z',
    });
  });

  it('treats out-of-range relative dates as text instead of throwing', () => {
    expect(parseEmailSearch('after:999999999y')).toEqual({
      type: 'text',
      value: 'after:999999999y',
      exact: false,
    });
  });

  it('supports dash negation and escaped quotes', () => {
    expect(parseEmailSearch('-from:amy subject:"say \\"hello\\""')).toEqual({
      type: 'and',
      operands: [
        { type: 'not', operand: { type: 'field', field: 'from', value: 'amy' } },
        { type: 'field', field: 'subject', value: 'say "hello"' },
      ],
    });
  });

  it('treats unknown and invalid operators as text instead of dropping them', () => {
    expect(parseEmailSearch('priority:high after:2026-02-30')).toEqual({
      type: 'and',
      operands: [
        { type: 'text', value: 'priority:high', exact: false },
        { type: 'text', value: 'after:2026-02-30', exact: false },
      ],
    });
  });

  it('does not consume a quoted value after an unknown operator', () => {
    expect(parseEmailSearch('priority:"very high"')).toEqual({
      type: 'and',
      operands: [
        { type: 'text', value: 'priority:', exact: false },
        { type: 'text', value: 'very high', exact: true },
      ],
    });
  });

  it.each([
    ['after:2026/07/03', 'after', '2026-07-03T00:00:00.000Z'],
    ['after:07/03/2026', 'after', '2026-07-03T00:00:00.000Z'],
    ['before:2026-12-31', 'before', '2026-12-31T00:00:00.000Z'],
  ])('parses date form %s', (query, field, value) => {
    expect(parseEmailSearch(query)).toEqual({ type: 'field', field, value });
  });

  it.each([
    ['to:a@example.com', 'to', 'a@example.com'],
    ['cc:a@example.com', 'cc', 'a@example.com'],
    ['bcc:a@example.com', 'bcc', 'a@example.com'],
    ['subject:meeting', 'subject', 'meeting'],
    ['label:Work', 'label', 'Work'],
    ['filename:report.pdf', 'filename', 'report.pdf'],
    ['filetype:PDF', 'filetype', 'PDF'],
    ['is:read', 'read', true],
    ['is:unread', 'read', false],
    ['is:starred', 'starred', true],
    ['in:sent', 'folder', 'sent'],
    ['is:trash', 'folder', 'trash'],
  ])('parses operator %s', (query, field, value) => {
    expect(parseEmailSearch(query)).toEqual({ type: 'field', field, value });
  });

  it('keeps case in values while treating boolean keywords case-insensitively', () => {
    expect(parseEmailSearch('from:Amy or SUBJECT:RoadMap and not label:Spam')).toEqual({
      type: 'or',
      operands: [
        { type: 'field', field: 'from', value: 'Amy' },
        {
          type: 'and',
          operands: [
            { type: 'field', field: 'subject', value: 'RoadMap' },
            { type: 'not', operand: { type: 'field', field: 'label', value: 'Spam' } },
          ],
        },
      ],
    });
  });
});
