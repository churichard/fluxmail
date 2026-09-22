import iconv from 'iconv-lite';
import {
  extractSearchContext,
  htmlToReadableText,
  SEARCH_CONTEXT_INPUT_LIMIT,
  type AttachmentMeta,
  type Message,
  type MessageBody,
} from '@fluxmail/core';
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

export interface DownloadedListBody {
  snippet?: string;
  searchContext?: NonNullable<Message['searchContext']>;
}

/** Download the preferred text part once for optional list-result enrichment. */
export async function downloadListBody(
  client: ImapFlow,
  uid: number,
  parts: BodyParts,
  options: { snippet: boolean; searchContextText?: string },
): Promise<DownloadedListBody> {
  const part = parts.text ?? parts.html;
  if (!part) {
    return options.searchContextText ? { searchContext: { status: 'unavailable' } } : {};
  }
  const inputLimit = options.searchContextText ? SEARCH_CONTEXT_INPUT_LIMIT : SNIPPET_INPUT_LIMIT;
  const { meta, content } = await client.download(uid, part, { uid: true, maxBytes: inputLimit });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of content) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = inputLimit - size;
    if (remaining <= 0) break;
    chunks.push(bytes.subarray(0, remaining));
    size += Math.min(bytes.length, remaining);
    if (size >= inputLimit) break;
  }
  const charset = meta.charset && iconv.encodingExists(meta.charset) ? meta.charset : 'utf-8';
  const decoded = iconv.decode(Buffer.concat(chunks, size), charset);
  const selectedBody = parts.text ? { text: decoded } : { html: decoded };
  const result: DownloadedListBody = {};
  if (options.snippet) {
    const text = (parts.text ? decoded : htmlToReadableText(decoded)).replace(/\s+/gu, ' ').trim();
    if (text) result.snippet = [...text].slice(0, SNIPPET_OUTPUT_LIMIT).join('');
  }
  if (options.searchContextText) {
    result.searchContext = extractSearchContext(selectedBody, options.searchContextText, {
      complete: size < inputLimit || meta.expectedSize <= size,
    });
  }
  return result;
}

/** Download only the preferred text part and return a bounded one-line preview. */
export async function downloadSnippet(client: ImapFlow, uid: number, parts: BodyParts): Promise<string | undefined> {
  return (await downloadListBody(client, uid, parts, { snippet: true })).snippet;
}

export async function downloadBody(client: ImapFlow, uid: number, parts: BodyParts): Promise<MessageBody> {
  const body: MessageBody = {};
  if (parts.text) body.text = await readPart(client, uid, parts.text);
  if (parts.html) body.html = await readPart(client, uid, parts.html);
  return body;
}
