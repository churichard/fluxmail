import { describe, expect, it } from 'vitest';
import type { gmail_v1 } from 'googleapis';
import { findAttachment, parseGmailMessage, walkParts } from '../src/parse.js';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function bufferB64url(data: Buffer): string {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

const multipartMessage: gmail_v1.Schema$Message = {
  id: 'msg1',
  threadId: 'thread1',
  internalDate: '1751976000000',
  snippet: 'Hi there',
  labelIds: ['INBOX', 'UNREAD', 'STARRED', 'Label_7'],
  payload: {
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: 'Ann <ann@example.com>' },
      { name: 'To', value: 'me@example.com' },
      { name: 'Subject', value: 'Report' },
      { name: 'Message-ID', value: '<abc@mail.example.com>' },
    ],
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('plain body') } },
          { mimeType: 'text/html', body: { data: b64url('<p>html body</p>') } },
        ],
      },
      {
        mimeType: 'application/pdf',
        filename: 'report.pdf',
        headers: [
          { name: 'Content-ID', value: '<report-image@example.com>' },
          { name: 'Content-Disposition', value: 'inline; filename="report.pdf"' },
        ],
        body: { attachmentId: 'att1', size: 12345 },
      },
      {
        partId: '3',
        mimeType: 'text/plain',
        filename: 'notes.txt',
        body: { data: b64url('inline attachment'), size: 17 },
      },
    ],
  },
};

describe('walkParts', () => {
  it('collects text, html, and attachments from a nested tree', () => {
    const walked = walkParts(multipartMessage.payload);
    expect(walked.body.text).toBe('plain body');
    expect(walked.body.html).toBe('<p>html body</p>');
    expect(walked.attachments).toEqual([
      {
        id: 'att1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
        contentId: 'report-image@example.com',
        disposition: 'inline',
      },
      { id: 'inline:3', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 17 },
    ]);
  });

  it('keeps inline attachment data out of the message body and makes it retrievable', () => {
    const walked = walkParts(multipartMessage.payload);
    expect(walked.body.text).toBe('plain body');
    expect(findAttachment(multipartMessage.payload, 'inline:3')).toEqual({
      meta: { id: 'inline:3', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 17 },
      content: Buffer.from('inline attachment'),
    });
  });

  it('decodes text using the charset declared by the MIME part', () => {
    const walked = walkParts({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset=windows-1252' }],
      body: { data: bufferB64url(Buffer.from([0x63, 0x61, 0x66, 0xe9])) },
    });

    expect(walked.body.text).toBe('café');
  });
});

describe('parseGmailMessage', () => {
  const ctx = {
    accountId: 'acct_1',
    labelNames: new Map([['Label_7', 'Projects']]),
    includeBody: true,
    includeHeaders: true,
  };

  it('maps flags from labelIds', () => {
    const m = parseGmailMessage(multipartMessage, ctx);
    expect(m.flags).toEqual({ read: false, starred: true, draft: false });
  });

  it('translates label ids to names', () => {
    const m = parseGmailMessage(multipartMessage, ctx);
    expect(m.labels).toContain('Projects');
    expect(m.labels).toContain('INBOX');
  });

  it('parses addresses, subject, and date', () => {
    const m = parseGmailMessage(multipartMessage, ctx);
    expect(m.from).toEqual({ name: 'Ann', email: 'ann@example.com' });
    expect(m.to).toEqual([{ email: 'me@example.com' }]);
    expect(m.subject).toBe('Report');
    expect(m.date).toBe(new Date(1751976000000).toISOString());
  });

  it('exposes threading headers when requested', () => {
    const m = parseGmailMessage(multipartMessage, ctx);
    expect(m.headers?.['Message-ID']).toBe('<abc@mail.example.com>');
  });

  it('omits body when includeBody is false', () => {
    const m = parseGmailMessage(multipartMessage, { ...ctx, includeBody: false });
    expect(m.body).toBeUndefined();
    expect(m.attachments).toHaveLength(2);
  });
});
