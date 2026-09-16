import iconv from 'iconv-lite';
import type { AttachmentMeta, MessageBody } from '@fluxmail/core';
import type { ImapFlow, MessageStructureObject } from 'imapflow';

export interface BodyParts {
  text?: string;
  html?: string;
  attachments: AttachmentMeta[];
}

export function inspectStructure(structure: MessageStructureObject | undefined): BodyParts {
  const result: BodyParts = { attachments: [] };
  if (!structure) return result;
  const visit = (node: MessageStructureObject) => {
    const part = node.part ?? (node === structure && !node.childNodes?.length ? '1' : undefined);
    const disposition = node.disposition?.toLowerCase();
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
    const mimeType = node.type.toLowerCase();
    const attached =
      disposition === 'attachment' ||
      Boolean(filename) ||
      mimeType === 'message/rfc822' ||
      (disposition === 'inline' && mimeType !== 'text/plain' && mimeType !== 'text/html') ||
      (Boolean(node.id) && !mimeType.startsWith('text/'));
    if (attached && part) {
      result.attachments.push({
        id: `part:${part}`,
        filename: filename ?? 'attachment',
        mimeType: node.type || 'application/octet-stream',
        sizeBytes: node.size ?? 0,
        ...(node.id ? { contentId: node.id.replace(/^<|>$/g, '') } : {}),
        disposition: disposition === 'inline' ? 'inline' : 'attachment',
      });
      return;
    }
    if (part) {
      if (mimeType === 'text/plain' && !result.text) result.text = part;
      if (mimeType === 'text/html' && !result.html) result.html = part;
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(structure);
  return result;
}

async function readPart(client: ImapFlow, uid: number, part: string): Promise<string> {
  const { meta, content } = await client.download(uid, part, { uid: true });
  const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  const charset = meta.charset && iconv.encodingExists(meta.charset) ? meta.charset : 'utf-8';
  return iconv.decode(bytes, charset);
}

const SNIPPET_INPUT_LIMIT = 16 * 1024;
const SNIPPET_OUTPUT_LIMIT = 300;

function htmlToText(value: string): string {
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** Download only the preferred text part and return a bounded one-line preview. */
export async function downloadSnippet(client: ImapFlow, uid: number, parts: BodyParts): Promise<string | undefined> {
  const part = parts.text ?? parts.html;
  if (!part) return undefined;
  const { meta, content } = await client.download(uid, part, { uid: true, maxBytes: SNIPPET_INPUT_LIMIT });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of content) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = SNIPPET_INPUT_LIMIT - size;
    if (remaining <= 0) break;
    chunks.push(bytes.subarray(0, remaining));
    size += Math.min(bytes.length, remaining);
    if (size >= SNIPPET_INPUT_LIMIT) break;
  }
  const charset = meta.charset && iconv.encodingExists(meta.charset) ? meta.charset : 'utf-8';
  const decoded = iconv.decode(Buffer.concat(chunks, size), charset);
  const text = (parts.text ? decoded : htmlToText(decoded)).replace(/\s+/gu, ' ').trim();
  return text ? [...text].slice(0, SNIPPET_OUTPUT_LIMIT).join('') : undefined;
}

export async function downloadBody(client: ImapFlow, uid: number, parts: BodyParts): Promise<MessageBody> {
  const body: MessageBody = {};
  if (parts.text) body.text = await readPart(client, uid, parts.text);
  if (parts.html) body.html = await readPart(client, uid, parts.html);
  return body;
}
