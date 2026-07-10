import type { gmail_v1 } from 'googleapis';
import iconv from 'iconv-lite';
import { parseAddressList, type AttachmentMeta, type Message, type MessageBody } from '@fluxmail/core';

export function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function encodeBase64Url(data: Buffer): string {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function headerValue(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string | undefined {
  return payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function decodeTextPart(part: gmail_v1.Schema$MessagePart): string {
  const data = decodeBase64Url(part.body?.data ?? '');
  const contentType = headerValue(part, 'Content-Type') ?? '';
  const charset = contentType.match(/charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i);
  const encoding = charset?.[1] ?? charset?.[2] ?? charset?.[3] ?? 'utf-8';
  return iconv.decode(data, iconv.encodingExists(encoding) ? encoding : 'utf-8');
}

interface WalkedParts {
  body: MessageBody;
  attachments: AttachmentMeta[];
}

interface ParsedAttachment {
  meta: AttachmentMeta;
  content?: Buffer;
}

function parseAttachment(part: gmail_v1.Schema$MessagePart, path: number[]): ParsedAttachment | undefined {
  if (!part.filename) return undefined;

  const body = part.body;
  const rawContentId = headerValue(part, 'Content-ID')?.trim();
  const contentId = rawContentId?.replace(/^<|>$/g, '');
  const rawDisposition = headerValue(part, 'Content-Disposition')?.split(';', 1)[0]?.trim().toLowerCase();
  const disposition: AttachmentMeta['disposition'] =
    rawDisposition === 'inline' || rawDisposition === 'attachment'
      ? rawDisposition
      : contentId
        ? 'inline'
        : undefined;
  const metadata = {
    ...(contentId ? { contentId } : {}),
    ...(disposition ? { disposition } : {}),
  };
  if (body?.attachmentId) {
    return {
      meta: {
        id: body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType ?? '',
        sizeBytes: body.size ?? 0,
        ...metadata,
      },
    };
  }
  if (body?.data) {
    const content = decodeBase64Url(body.data);
    return {
      meta: {
        id: `inline:${part.partId ?? path.join('.')}`,
        filename: part.filename,
        mimeType: part.mimeType ?? '',
        sizeBytes: body.size ?? content.length,
        ...metadata,
      },
      content,
    };
  }
  return undefined;
}

/** Walk the MIME tree collecting the preferred text/html bodies and attachment metadata. */
export function walkParts(payload: gmail_v1.Schema$MessagePart | undefined): WalkedParts {
  const result: WalkedParts = { body: {}, attachments: [] };
  if (!payload) return result;

  const visit = (part: gmail_v1.Schema$MessagePart, partPath: number[]) => {
    const mimeType = part.mimeType ?? '';
    const attachment = parseAttachment(part, partPath);
    if (attachment) {
      result.attachments.push(attachment.meta);
      return;
    }
    if (mimeType === 'text/plain' && part.body?.data && result.body.text === undefined) {
      result.body.text = decodeTextPart(part);
      return;
    }
    if (mimeType === 'text/html' && part.body?.data && result.body.html === undefined) {
      result.body.html = decodeTextPart(part);
      return;
    }
    for (const [index, child] of (part.parts ?? []).entries()) visit(child, [...partPath, index]);
  };
  visit(payload, [0]);
  return result;
}

export function findAttachment(
  payload: gmail_v1.Schema$MessagePart | undefined,
  attachmentId: string
): ParsedAttachment | undefined {
  if (!payload) return undefined;

  const visit = (part: gmail_v1.Schema$MessagePart, partPath: number[]): ParsedAttachment | undefined => {
    const attachment = parseAttachment(part, partPath);
    if (attachment?.meta.id === attachmentId) return attachment;
    for (const [index, child] of (part.parts ?? []).entries()) {
      const found = visit(child, [...partPath, index]);
      if (found) return found;
    }
    return undefined;
  };
  return visit(payload, [0]);
}

const INTERESTING_HEADERS = ['message-id', 'in-reply-to', 'references', 'list-unsubscribe'];

export interface ParseContext {
  accountId: string;
  /** Gmail label id -> display name, for translating labelIds. */
  labelNames: Map<string, string>;
  includeBody: boolean;
  includeHeaders?: boolean;
}

export function parseGmailMessage(msg: gmail_v1.Schema$Message, ctx: ParseContext): Message {
  const payload = msg.payload;
  const labelIds = msg.labelIds ?? [];
  const from = parseAddressList(headerValue(payload, 'From'))[0];
  const dateHeader = headerValue(payload, 'Date');
  const dateMs = msg.internalDate ? Number(msg.internalDate) : dateHeader ? Date.parse(dateHeader) : Date.now();

  const message: Message = {
    id: msg.id ?? '',
    threadId: msg.threadId ?? msg.id ?? '',
    accountId: ctx.accountId,
    labels: labelIds
      .filter((id) => !id.startsWith('CATEGORY_'))
      .map((id) => ctx.labelNames.get(id) ?? id),
    to: parseAddressList(headerValue(payload, 'To')),
    subject: headerValue(payload, 'Subject') ?? '',
    date: new Date(dateMs).toISOString(),
    attachments: [],
    flags: {
      read: !labelIds.includes('UNREAD'),
      starred: labelIds.includes('STARRED'),
      draft: labelIds.includes('DRAFT'),
    },
  };

  if (from) message.from = from;
  const cc = parseAddressList(headerValue(payload, 'Cc'));
  if (cc.length) message.cc = cc;
  const bcc = parseAddressList(headerValue(payload, 'Bcc'));
  if (bcc.length) message.bcc = bcc;
  const replyTo = parseAddressList(headerValue(payload, 'Reply-To'));
  if (replyTo.length) message.replyTo = replyTo;
  if (msg.snippet) message.snippet = msg.snippet;

  const walked = walkParts(payload);
  message.attachments = walked.attachments;
  if (ctx.includeBody) message.body = walked.body;

  if (ctx.includeHeaders) {
    const headers: Record<string, string> = {};
    for (const h of payload?.headers ?? []) {
      if (h.name && h.value && INTERESTING_HEADERS.includes(h.name.toLowerCase())) {
        headers[h.name] = h.value;
      }
    }
    message.headers = headers;
  }

  return message;
}
