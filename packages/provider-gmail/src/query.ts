import { EmailError, type EmailQuery, type EmailSearchExpression } from '@fluxmail/core';

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

function quote(value: string, force = false): string {
  if (!force && !/[\s"(){}]/.test(value)) return value;
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function epochSeconds(iso: string, field: 'after' | 'before'): number {
  const millis = new Date(iso).getTime();
  if (!Number.isFinite(millis)) {
    throw new EmailError('invalid_request', `${field} must be a valid ISO date, got "${iso}"`);
  }
  return Math.floor(millis / 1000);
}

function compileExpression(
  expression: EmailSearchExpression,
  resolveLabelId: (folder: string) => string | null,
): string {
  if (expression.type === 'all') return '';
  if (expression.type === 'none') return '-{in:anywhere}';
  if (expression.type === 'text') return expression.exact ? quote(expression.value, true) : expression.value;
  if (expression.type === 'and')
    return expression.operands
      .map((operand) => compileExpression(operand, resolveLabelId))
      .filter(Boolean)
      .join(' ');
  if (expression.type === 'or') {
    const operands = expression.operands
      .map((operand) => {
        const compiled = compileExpression(operand, resolveLabelId);
        return compiled && operand.type === 'and' ? `(${compiled})` : compiled;
      })
      .filter(Boolean);
    return operands.length ? `{${operands.join(' ')}}` : '';
  }
  if (expression.type === 'not') {
    const operand = compileExpression(expression.operand, resolveLabelId);
    if (!operand) return '-{in:anywhere}';
    return expression.operand.type === 'and' || expression.operand.type === 'or' ? `-(${operand})` : `-${operand}`;
  }
  const value = String(expression.value);
  switch (expression.field) {
    case 'from':
    case 'to':
    case 'cc':
    case 'bcc':
    case 'subject':
      return `${expression.field}:${quote(value)}`;
    case 'label': {
      const labelId = resolveLabelId(value);
      return `label:${quote(labelId ?? value)}`;
    }
    case 'folder': {
      const role = value.toLowerCase();
      if (role === 'all') return 'in:anywhere';
      if (role === 'draft' || role === 'drafts') return 'in:drafts';
      if (role === 'archive') return 'in:archive';
      if (role === 'starred') return 'is:starred';
      if (ROLE_TO_LABEL[role]) return `in:${role}`;
      const labelId = resolveLabelId(value);
      return `label:${quote(labelId ?? value)}`;
    }
    case 'has_attachment':
      return expression.value ? 'has:attachment' : '-has:attachment';
    case 'read':
      return expression.value ? 'is:read' : 'is:unread';
    case 'starred':
      return expression.value ? 'is:starred' : '-is:starred';
    case 'after':
      return `after:${epochSeconds(value, 'after')}`;
    case 'before':
      return `before:${epochSeconds(value, 'before')}`;
    case 'filename':
      return `filename:${quote(value)}`;
    case 'filetype':
      return `filename:${quote(value.replace(/^\./, ''))}`;
    case 'account':
      throw new EmailError('invalid_request', 'account filters must be resolved before calling a provider');
  }
}

function includesSpamOrTrash(expression: EmailSearchExpression, negated = false): boolean {
  if (expression.type === 'not') return includesSpamOrTrash(expression.operand, !negated);
  if (expression.type === 'and' || expression.type === 'or')
    return expression.operands.some((operand) => includesSpamOrTrash(operand, negated));
  if (expression.type !== 'field' || expression.field !== 'folder' || negated) return false;
  return ['all', 'spam', 'trash'].includes(String(expression.value).toLowerCase());
}

/**
 * Translate the unified EmailQuery into Gmail's q= syntax + labelIds.
 * `resolveLabelId` maps a user folder name/id to a Gmail label id (null if unknown).
 */
export function toGmailQuery(q: EmailQuery, resolveLabelId: (folder: string) => string | null): GmailQuery {
  const parts: string[] = [];
  const out: GmailQuery = {};

  if (q.folder) {
    const role = q.folder.toLowerCase();
    if (role === 'archive') {
      parts.push('in:archive');
    } else if (role === 'all') {
      // Gmail's default scope is All Mail, which excludes Spam and Trash.
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
  if (q.read !== undefined) parts.push(q.read ? 'is:read' : 'is:unread');
  else if (q.unreadOnly) parts.push('is:unread');
  if (q.starred !== undefined) parts.push(q.starred ? 'is:starred' : '-is:starred');
  else if (q.starredOnly) parts.push('is:starred');
  if (q.hasAttachment !== undefined) parts.push(q.hasAttachment ? 'has:attachment' : '-has:attachment');
  if (q.after) parts.push(`after:${epochSeconds(q.after, 'after')}`);
  if (q.before) parts.push(`before:${epochSeconds(q.before, 'before')}`);
  if (q.rawProviderQuery) parts.push(q.rawProviderQuery);
  if (q.expression) {
    const expression = compileExpression(q.expression, resolveLabelId);
    if (expression) parts.push(expression);
    if (includesSpamOrTrash(q.expression)) out.includeSpamTrash = true;
  }

  if (parts.length) out.q = parts.join(' ');
  return out;
}
