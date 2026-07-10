import type { EmailQuery } from '@fluxmail/core';

export const ROLE_TO_LABEL: Record<string, string> = {
  inbox: 'INBOX',
  sent: 'SENT',
  drafts: 'DRAFT',
  trash: 'TRASH',
  spam: 'SPAM',
  starred: 'STARRED',
};

export interface GmailQuery {
  q?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

function quote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function epochSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/**
 * Translate the unified EmailQuery into Gmail's q= syntax + labelIds.
 * `resolveLabelId` maps a user folder name/id to a Gmail label id (null if unknown).
 */
export function toGmailQuery(
  q: EmailQuery,
  resolveLabelId: (folder: string) => string | null
): GmailQuery {
  const parts: string[] = [];
  const out: GmailQuery = {};

  if (q.folder) {
    const role = q.folder.toLowerCase();
    if (role === 'archive') {
      // Gmail has no archive label: archived mail is everything outside inbox/trash/spam.
      parts.push('-in:inbox', '-in:trash', '-in:spam', '-in:draft');
    } else if (role === 'all') {
      parts.push('in:anywhere');
    } else if (ROLE_TO_LABEL[role]) {
      out.labelIds = [ROLE_TO_LABEL[role]];
      if (role === 'trash' || role === 'spam') out.includeSpamTrash = true;
    } else {
      const labelId = resolveLabelId(q.folder);
      if (labelId) out.labelIds = [labelId];
      else parts.push(`label:${quote(q.folder)}`);
    }
  }

  if (q.text) parts.push(q.text);
  if (q.from) parts.push(`from:${quote(q.from)}`);
  if (q.to) parts.push(`to:${quote(q.to)}`);
  if (q.subject) parts.push(`subject:${quote(q.subject)}`);
  if (q.unreadOnly) parts.push('is:unread');
  if (q.starredOnly) parts.push('is:starred');
  if (q.hasAttachment) parts.push('has:attachment');
  if (q.after) parts.push(`after:${epochSeconds(q.after)}`);
  if (q.before) parts.push(`before:${epochSeconds(q.before)}`);
  if (q.rawProviderQuery) parts.push(q.rawProviderQuery);

  if (parts.length) out.q = parts.join(' ');
  return out;
}
