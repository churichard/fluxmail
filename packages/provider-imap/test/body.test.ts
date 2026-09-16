import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { MessageStructureObject } from 'imapflow';
import { downloadSnippet, inspectStructure } from '../src/body.js';

describe('IMAP body structure', () => {
  it('uses part 1 for a single-part message', () => {
    const structure = {
      type: 'text/plain',
      parameters: { charset: 'utf-8' },
      encoding: '7bit',
      size: 12,
    } as MessageStructureObject;

    expect(inspectStructure(structure)).toEqual({ text: '1', attachments: [] });
  });

  it('reports inline images without filenames as attachments', () => {
    const structure = {
      type: 'multipart/related',
      childNodes: [
        { part: '1', type: 'text/html', encoding: '7bit', size: 12 },
        { part: '2', type: 'image/png', encoding: 'base64', size: 24, disposition: 'inline', id: '<logo>' },
      ],
    } as MessageStructureObject;

    expect(inspectStructure(structure)).toMatchObject({
      html: '1',
      attachments: [{ id: 'part:2', mimeType: 'image/png', disposition: 'inline', contentId: 'logo' }],
    });
  });

  it('does not use text inside an attached message as the outer body', () => {
    const structure = {
      type: 'multipart/mixed',
      childNodes: [
        { part: '1', type: 'text/plain', encoding: '7bit', size: 12 },
        {
          part: '2',
          type: 'message/rfc822',
          encoding: '7bit',
          size: 40,
          childNodes: [{ part: '2.1', type: 'text/html', encoding: '7bit', size: 20 }],
        },
      ],
    } as MessageStructureObject;

    expect(inspectStructure(structure)).toEqual({
      text: '1',
      attachments: [
        {
          id: 'part:2',
          filename: 'attachment',
          mimeType: 'message/rfc822',
          sizeBytes: 40,
          disposition: 'attachment',
        },
      ],
    });
  });

  it('creates a bounded plain-text snippet from one partial download', async () => {
    const download = vi.fn().mockResolvedValue({
      meta: { charset: 'utf-8' },
      content: Readable.from([Buffer.from(`  Hello\n\nworld  ${'é'.repeat(400)}`)]),
    });

    const snippet = await downloadSnippet({ download } as never, 7, { text: '1', attachments: [] });

    expect(snippet).toHaveLength(300);
    expect(snippet).toMatch(/^Hello world é+/);
    expect(download).toHaveBeenCalledWith(7, '1', { uid: true, maxBytes: 16 * 1024 });
  });

  it('uses HTML only when no plain-text part is available', async () => {
    const download = vi.fn().mockResolvedValue({
      meta: { charset: 'utf-8' },
      content: Readable.from([Buffer.from('<p>Hello&nbsp;<strong>world</strong></p><script>ignore()</script>')]),
    });

    await expect(downloadSnippet({ download } as never, 8, { html: '2', attachments: [] })).resolves.toBe(
      'Hello world',
    );
  });
});
