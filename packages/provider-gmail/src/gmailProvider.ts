import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'googleapis-common';
import {
  EmailError,
  replySubject,
  type AttachmentMeta,
  type Capabilities,
  type DraftInput,
  type EmailProvider,
  type EmailQuery,
  type Folder,
  type FolderRole,
  type GetMessageOpts,
  type Message,
  type ModifyAction,
  type Page,
  type PageOpts,
  type SendResult,
  type Thread,
} from '@fluxmail/core';
import { toGmailQuery, ROLE_TO_LABEL } from './query.js';
import { encodeBase64Url, decodeBase64Url, findAttachment, parseGmailMessage } from './parse.js';
import { buildRawMessage, type ThreadingHeaders } from './mime.js';
import { withRetry } from './errors.js';

const LABEL_TO_ROLE: Record<string, FolderRole> = {
  INBOX: 'inbox',
  SENT: 'sent',
  DRAFT: 'drafts',
  TRASH: 'trash',
  SPAM: 'spam',
  STARRED: 'starred',
};

const METADATA_HEADERS = ['From', 'To', 'Cc', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'References', 'In-Reply-To'];
const LABEL_CACHE_TTL_MS = 60_000;
const HYDRATE_CONCURRENCY = 10;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GmailProviderOptions {
  accountId: string;
  email: string;
  /** Stored sender name used when Gmail settings and the current Google profile have no name. */
  displayName?: string;
  auth: OAuth2Client;
}

export const GMAIL_CAPABILITIES: Capabilities = {
  labels: true,
  serverThreads: true,
  serverSearch: 'rich',
  snippets: true,
};

export class GmailProvider implements EmailProvider {
  readonly capabilities: Capabilities = GMAIL_CAPABILITIES;

  private readonly gmail: gmail_v1.Gmail;
  private readonly accountId: string;
  private readonly email: string;
  private readonly displayName: string | undefined;
  private readonly auth: OAuth2Client;
  private labelCache: { fetchedAt: number; labels: gmail_v1.Schema$Label[] } | null = null;
  /** undefined = not resolved yet; null = no name available. */
  private senderName: string | null | undefined;

  constructor(opts: GmailProviderOptions) {
    this.accountId = opts.accountId;
    this.email = opts.email;
    this.displayName = opts.displayName;
    this.auth = opts.auth;
    this.gmail = google.gmail({ version: 'v1', auth: opts.auth });
  }

  /**
   * Sender name for the From header, matching what the Gmail UI would use:
   * the primary send-as displayName when set, else the current Google profile
   * name, with the stored account name as an offline fallback.
   */
  private async resolveSenderName(): Promise<string | null> {
    if (this.senderName !== undefined) return this.senderName;
    let sendAsName: string | undefined;
    try {
      const res = await withRetry(() => this.gmail.users.settings.sendAs.list({ userId: 'me' }));
      const primary =
        res.data.sendAs?.find((s) => s.isPrimary) ??
        res.data.sendAs?.find((s) => s.sendAsEmail === this.email);
      sendAsName = primary?.displayName?.trim() || undefined;
    } catch {
      // Fall through to the profile and stored account name.
    }
    if (sendAsName) {
      this.senderName = sendAsName;
      return this.senderName;
    }

    try {
      const res = await withRetry(() =>
        this.auth.request<{ name?: string }>({ url: GOOGLE_USERINFO_URL })
      );
      const profileName = res.data.name?.trim();
      if (profileName) {
        this.senderName = profileName;
        return this.senderName;
      }
    } catch {
      // Profile lookup is optional; sending should still work without it.
    }
    this.senderName = this.displayName?.trim() || null;
    return this.senderName;
  }

  async testConnection(): Promise<void> {
    await withRetry(() => this.gmail.users.getProfile({ userId: 'me' }));
  }

  private async labels(forceRefresh = false): Promise<gmail_v1.Schema$Label[]> {
    if (!forceRefresh && this.labelCache && Date.now() - this.labelCache.fetchedAt < LABEL_CACHE_TTL_MS) {
      return this.labelCache.labels;
    }
    const res = await withRetry(() => this.gmail.users.labels.list({ userId: 'me' }));
    const labels = res.data.labels ?? [];
    this.labelCache = { fetchedAt: Date.now(), labels };
    return labels;
  }

  private async labelNameMap(): Promise<Map<string, string>> {
    const labels = await this.labels();
    return new Map(labels.filter((l) => l.id && l.name).map((l) => [l.id!, l.name!]));
  }

  /** Gmail messages carry the DRAFT label, but only Draft resources expose the draft id. */
  private async attachDraftIds(messages: Message[]): Promise<void> {
    const unresolved = new Map(
      messages.filter((message) => message.flags.draft).map((message) => [message.id, message])
    );
    if (!unresolved.size) return;

    let pageToken: string | undefined;
    do {
      const res = await withRetry(() =>
        this.gmail.users.drafts.list({
          userId: 'me',
          maxResults: 500,
          ...(pageToken ? { pageToken } : {}),
        })
      );
      for (const draft of res.data.drafts ?? []) {
        const message = draft.message?.id ? unresolved.get(draft.message.id) : undefined;
        if (message && draft.id) {
          message.draftId = draft.id;
          unresolved.delete(message.id);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (unresolved.size && pageToken);
  }

  private async resolveLabelId(folder: string, createIfMissing = false): Promise<string> {
    const role = folder.toLowerCase();
    if (ROLE_TO_LABEL[role]) return ROLE_TO_LABEL[role];
    const labels = await this.labels();
    const match = labels.find((l) => l.id === folder || l.name?.toLowerCase() === folder.toLowerCase());
    if (match?.id) return match.id;
    if (!createIfMissing) {
      throw new EmailError('not_found', `No Gmail label or folder named "${folder}"`);
    }
    const created = await withRetry(() =>
      this.gmail.users.labels.create({ userId: 'me', requestBody: { name: folder } })
    );
    this.labelCache = null;
    if (!created.data.id) throw new EmailError('provider_unavailable', 'Gmail did not return a label id');
    return created.data.id;
  }

  async listMessages(q: EmailQuery, page?: PageOpts): Promise<Page<Message>> {
    const labels = await this.labels();
    const gq = toGmailQuery(q, (folder) => {
      const match = labels.find((l) => l.id === folder || l.name?.toLowerCase() === folder.toLowerCase());
      return match?.id ?? null;
    });
    const pageSize = Math.min(page?.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const res = await withRetry(() =>
      this.gmail.users.messages.list({
        userId: 'me',
        maxResults: pageSize,
        ...(page?.pageToken ? { pageToken: page.pageToken } : {}),
        ...(gq.q ? { q: gq.q } : {}),
        ...(gq.labelIds ? { labelIds: gq.labelIds } : {}),
        ...(gq.includeSpamTrash ? { includeSpamTrash: true } : {}),
      })
    );

    const ids = (res.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    const labelNames = await this.labelNameMap();
    const items: Message[] = [];
    for (let i = 0; i < ids.length; i += HYDRATE_CONCURRENCY) {
      const chunk = ids.slice(i, i + HYDRATE_CONCURRENCY);
      const fetched = await Promise.all(
        chunk.map((id) =>
          withRetry(() =>
            this.gmail.users.messages.get({
              userId: 'me',
              id,
              format: 'metadata',
              metadataHeaders: METADATA_HEADERS,
            })
          )
        )
      );
      for (const f of fetched) {
        items.push(parseGmailMessage(f.data, { accountId: this.accountId, labelNames, includeBody: false }));
      }
    }
    await this.attachDraftIds(items);
    const out: Page<Message> = { items };
    if (res.data.nextPageToken) out.nextPageToken = res.data.nextPageToken;
    return out;
  }

  async getMessage(id: string, opts?: GetMessageOpts): Promise<Message> {
    const res = await withRetry(() => this.gmail.users.messages.get({ userId: 'me', id, format: 'full' }));
    const labelNames = await this.labelNameMap();
    const message = parseGmailMessage(res.data, {
      accountId: this.accountId,
      labelNames,
      includeBody: true,
      includeHeaders: opts?.includeHeaders ?? false,
    });
    await this.attachDraftIds([message]);
    return message;
  }

  async getThread(threadId: string): Promise<Thread> {
    const res = await withRetry(() =>
      this.gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })
    );
    const labelNames = await this.labelNameMap();
    const messages = (res.data.messages ?? []).map((m) =>
      parseGmailMessage(m, { accountId: this.accountId, labelNames, includeBody: true })
    );
    await this.attachDraftIds(messages);
    return {
      id: res.data.id ?? threadId,
      subject: messages[0]?.subject ?? '',
      messages,
    };
  }

  async listFolders(): Promise<Folder[]> {
    const labels = await this.labels(true);
    const folders: Folder[] = [];
    for (const label of labels) {
      if (!label.id || !label.name) continue;
      // Hide Gmail-internal labels that aren't useful as folders.
      if (label.id.startsWith('CATEGORY_') || label.id === 'CHAT' || label.id === 'UNREAD' || label.id === 'IMPORTANT') {
        continue;
      }
      const folder: Folder = { id: label.id, name: label.name };
      const role = LABEL_TO_ROLE[label.id];
      if (role) folder.role = role;
      if (typeof label.messagesUnread === 'number') folder.unreadCount = label.messagesUnread;
      folders.push(folder);
    }
    return folders;
  }

  /** Resolve reply threading (headers + Gmail thread id) from the message being replied to. */
  private async resolveReply(replyToMessageId: string): Promise<ThreadingHeaders & { threadId: string; subject: string }> {
    const res = await withRetry(() =>
      this.gmail.users.messages.get({
        userId: 'me',
        id: replyToMessageId,
        format: 'metadata',
        metadataHeaders: ['Message-ID', 'References', 'Subject'],
      })
    );
    const headers = res.data.payload?.headers ?? [];
    const get = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
    const messageId = get('Message-ID');
    const references = [get('References'), messageId].filter(Boolean).join(' ');
    const out: ThreadingHeaders & { threadId: string; subject: string } = {
      threadId: res.data.threadId ?? '',
      subject: get('Subject'),
    };
    if (messageId) out.inReplyTo = messageId;
    if (references) out.references = references;
    return out;
  }

  private async composeRaw(
    d: DraftInput
  ): Promise<{ raw: string; threadId?: string }> {
    let threading: ThreadingHeaders | undefined;
    let threadId: string | undefined;
    const draft = { ...d };
    if (d.replyToMessageId) {
      const reply = await this.resolveReply(d.replyToMessageId);
      threading = reply;
      threadId = reply.threadId || undefined;
      if (!draft.subject) draft.subject = replySubject(reply.subject);
    }
    const senderName = await this.resolveSenderName();
    const from = senderName ? { name: senderName, email: this.email } : { email: this.email };
    const raw = await buildRawMessage(draft, from, threading);
    const out: { raw: string; threadId?: string } = { raw: encodeBase64Url(raw) };
    if (threadId) out.threadId = threadId;
    return out;
  }

  private async draftToMessage(draft: gmail_v1.Schema$Draft): Promise<Message> {
    const messageId = draft.message?.id;
    if (!messageId) throw new EmailError('provider_unavailable', 'Gmail draft has no message id');
    const message = await this.getMessage(messageId);
    if (draft.id) message.draftId = draft.id;
    return message;
  }

  async createDraft(d: DraftInput): Promise<Message> {
    const { raw, threadId } = await this.composeRaw(d);
    const res = await withRetry(() =>
      this.gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw, ...(threadId ? { threadId } : {}) } },
      })
    );
    return this.draftToMessage(res.data);
  }

  async updateDraft(draftId: string, d: DraftInput): Promise<Message> {
    const { raw, threadId } = await this.composeRaw(d);
    const res = await withRetry(() =>
      this.gmail.users.drafts.update({
        userId: 'me',
        id: draftId,
        requestBody: { message: { raw, ...(threadId ? { threadId } : {}) } },
      })
    );
    return this.draftToMessage(res.data);
  }

  async deleteDraft(draftId: string): Promise<void> {
    await withRetry(() => this.gmail.users.drafts.delete({ userId: 'me', id: draftId }));
  }

  async send(input: DraftInput | { draftId: string }): Promise<SendResult> {
    if ('draftId' in input) {
      const res = await withRetry(() =>
        this.gmail.users.drafts.send({ userId: 'me', requestBody: { id: input.draftId } })
      );
      return { id: res.data.id ?? '', threadId: res.data.threadId ?? res.data.id ?? '' };
    }
    if (!input.to?.length) {
      throw new EmailError('invalid_request', 'Cannot send a message with no "to" recipients');
    }
    const { raw, threadId } = await this.composeRaw(input);
    const res = await withRetry(() =>
      this.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw, ...(threadId ? { threadId } : {}) },
      })
    );
    return { id: res.data.id ?? '', threadId: res.data.threadId ?? res.data.id ?? '' };
  }

  async modify(ids: string[], action: ModifyAction): Promise<void> {
    if (!ids.length) return;

    if (action === 'trash' || action === 'untrash' || action === 'delete') {
      for (const id of ids) {
        if (action === 'trash') await withRetry(() => this.gmail.users.messages.trash({ userId: 'me', id }));
        else if (action === 'untrash') await withRetry(() => this.gmail.users.messages.untrash({ userId: 'me', id }));
        else await withRetry(() => this.gmail.users.messages.delete({ userId: 'me', id }));
      }
      return;
    }

    let addLabelIds: string[] = [];
    let removeLabelIds: string[] = [];
    if (action === 'markRead') removeLabelIds = ['UNREAD'];
    else if (action === 'markUnread') addLabelIds = ['UNREAD'];
    else if (action === 'star') addLabelIds = ['STARRED'];
    else if (action === 'unstar') removeLabelIds = ['STARRED'];
    else if (action === 'archive') removeLabelIds = ['INBOX'];
    else if ('move' in action) {
      addLabelIds = [await this.resolveLabelId(action.move, true)];
      removeLabelIds = ['INBOX'];
    } else if ('addLabels' in action) {
      addLabelIds = await Promise.all(action.addLabels.map((l) => this.resolveLabelId(l, true)));
    } else if ('removeLabels' in action) {
      removeLabelIds = await Promise.all(action.removeLabels.map((l) => this.resolveLabelId(l)));
    }

    await withRetry(() =>
      this.gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids,
          ...(addLabelIds.length ? { addLabelIds } : {}),
          ...(removeLabelIds.length ? { removeLabelIds } : {}),
        },
      })
    );
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<{ meta: AttachmentMeta; content: Buffer }> {
    const msg = await withRetry(() =>
      this.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
    );
    const attachment = findAttachment(msg.data.payload, attachmentId);
    if (!attachment) throw new EmailError('not_found', `Attachment ${attachmentId} not found on message ${messageId}`);
    if (attachment.content !== undefined) {
      return { meta: attachment.meta, content: attachment.content };
    }
    const res = await withRetry(() =>
      this.gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId })
    );
    if (!res.data.data) throw new EmailError('provider_unavailable', 'Gmail returned no attachment data');
    return { meta: attachment.meta, content: decodeBase64Url(res.data.data) };
  }
}
