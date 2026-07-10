import { describe, expect, it } from 'vitest';
import { buildRawMessage } from '../src/mime.js';

describe('buildRawMessage', () => {
  it('includes the sender display name in the From header', async () => {
    const raw = await buildRawMessage(
      { to: [{ email: 'bob@example.com' }], subject: 'Hi', body: { text: 'hello' } },
      { name: 'Richard Chu', email: 'me@example.com' }
    );
    expect(raw.toString()).toMatch(/From: "?Richard Chu"? <me@example\.com>/);
  });

  it('falls back to a bare address when no name is available', async () => {
    const raw = await buildRawMessage(
      { to: [{ email: 'bob@example.com' }], subject: 'Hi', body: { text: 'hello' } },
      { email: 'me@example.com' }
    );
    expect(raw.toString()).toMatch(/From: (me@example\.com|<me@example\.com>)/);
  });

  it('sets reply threading headers', async () => {
    const raw = await buildRawMessage(
      { to: [{ email: 'bob@example.com' }], subject: 'Re: Hi', body: { text: 'hello' } },
      { email: 'me@example.com' },
      { inReplyTo: '<orig@mail.example.com>', references: '<root@mail.example.com> <orig@mail.example.com>' }
    );
    const text = raw.toString();
    expect(text).toContain('In-Reply-To: <orig@mail.example.com>');
    expect(text).toContain('References: <root@mail.example.com> <orig@mail.example.com>');
  });

  it('preserves inline attachment content ids', async () => {
    const raw = await buildRawMessage(
      {
        to: [{ email: 'bob@example.com' }],
        subject: 'Inline image',
        body: { html: '<img src="cid:chart@example.com">' },
        attachments: [
          {
            filename: 'chart.png',
            mimeType: 'image/png',
            content: Buffer.from('image data').toString('base64'),
            contentId: 'chart@example.com',
            disposition: 'inline',
          },
        ],
      },
      { email: 'me@example.com' }
    );
    const text = raw.toString();
    expect(text).toContain('Content-ID: <chart@example.com>');
    expect(text).toContain('Content-Disposition: inline; filename=chart.png');
  });
});
