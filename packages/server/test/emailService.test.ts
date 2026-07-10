import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@fluxmail/core';
import { buildForwardBody, EmailService } from '../src/service/emailService.js';

const original: Message = {
  id: 'm1',
  threadId: 't1',
  accountId: 'acct_1',
  from: { name: 'Ann', email: 'ann@example.com' },
  to: [{ email: 'me@example.com' }],
  cc: [{ email: 'carol@example.com' }],
  subject: 'Report',
  date: '2026-07-01T12:00:00.000Z',
  body: { text: 'original text', html: '<p>original <b>html</b></p>' },
  attachments: [],
  flags: { read: true, starred: false, draft: false },
};

describe('buildForwardBody', () => {
  it('includes the forwarded-message header block and original text', () => {
    const body = buildForwardBody(original, 'FYI');
    expect(body.text).toContain('FYI');
    expect(body.text).toContain('---------- Forwarded message ----------');
    expect(body.text).toContain('From: Ann <ann@example.com>');
    expect(body.text).toContain('Cc: carol@example.com');
    expect(body.text).toContain('original text');
  });

  it('builds an html version quoting the original html', () => {
    const body = buildForwardBody(original);
    expect(body.html).toContain('<blockquote');
    expect(body.html).toContain('<p>original <b>html</b></p>');
  });

  it('escapes html in the comment', () => {
    const body = buildForwardBody(original, '<script>alert(1)</script>');
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;');
  });

  it('handles text-only originals', () => {
    const body = buildForwardBody({ ...original, body: { text: 'only text' } });
    expect(body.text).toContain('only text');
    expect(body.html).toBeUndefined();
  });
});

describe('EmailService.forward', () => {
  it('preserves inline attachment metadata', async () => {
    const message: Message = {
      ...original,
      body: { html: '<img src="cid:chart@example.com">' },
      attachments: [
        {
          id: 'attachment_1',
          filename: 'chart.png',
          mimeType: 'image/png',
          sizeBytes: 10,
          contentId: 'chart@example.com',
          disposition: 'inline',
        },
      ],
    };
    const send = vi.fn().mockResolvedValue({ id: 'sent_1', threadId: 'thread_1' });
    const provider = {
      getMessage: vi.fn().mockResolvedValue(message),
      getAttachment: vi.fn().mockResolvedValue({
        meta: message.attachments[0],
        content: Buffer.from('image data'),
      }),
      send,
    };
    const registry = {
      resolveAccountId: () => 'acct_1',
      getAccount: () => ({
        id: 'acct_1',
        provider: 'gmail',
        email: 'me@example.com',
        status: 'active',
        capabilities: {},
      }),
      getProvider: () => provider,
      markStatus: vi.fn(),
    };
    const service = new EmailService(registry as never);

    await service.forward(undefined, {
      messageId: message.id,
      to: [{ email: 'bob@example.com' }],
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            filename: 'chart.png',
            contentId: 'chart@example.com',
            disposition: 'inline',
          }),
        ],
      })
    );
  });
});
