import { EmailError, type EmailQuery, type EmailSearchExpression } from '@fluxmail/core';
import type { SearchObject } from 'imapflow';

function date(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new EmailError('invalid_request', `${field} must be an ISO date`);
  return parsed;
}

function gmailQuote(value: string): string {
  return /[\s"(){}]/.test(value) ? `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : value;
}

function preciseDate(value: string, field: string, supportsWithin: boolean): Date {
  const parsed = date(value, field);
  if (
    !supportsWithin &&
    (parsed.getUTCHours() !== 0 ||
      parsed.getUTCMinutes() !== 0 ||
      parsed.getUTCSeconds() !== 0 ||
      parsed.getUTCMilliseconds() !== 0)
  ) {
    throw new EmailError('unsupported_capability', 'Precise boolean date search requires the IMAP WITHIN extension');
  }
  return parsed;
}

function expressionSearch(
  expression: EmailSearchExpression,
  supportsGmailRaw: boolean,
  supportsWithin: boolean,
): SearchObject {
  if (expression.type === 'all') return { all: true };
  if (expression.type === 'none') return { not: { all: true } };
  if (expression.type === 'text') return { text: expression.value };
  if (expression.type === 'not') return { not: expressionSearch(expression.operand, supportsGmailRaw, supportsWithin) };
  if (expression.type === 'or')
    return {
      or: expression.operands.map((operand) => expressionSearch(operand, supportsGmailRaw, supportsWithin)),
    };
  if (expression.type === 'and') {
    const operands = expression.operands.map((operand) => expressionSearch(operand, supportsGmailRaw, supportsWithin));
    if (operands.length === 1) return operands[0]!;
    // ImapFlow has native OR and NOT nodes but no explicit AND node. De Morgan preserves repeated fields.
    return { not: { or: operands.map((operand) => ({ not: operand })) } };
  }
  const value = String(expression.value);
  switch (expression.field) {
    case 'from':
    case 'to':
    case 'cc':
    case 'bcc':
    case 'subject':
      return { [expression.field]: value };
    case 'read':
      return { seen: Boolean(expression.value) };
    case 'starred':
      return { flagged: Boolean(expression.value) };
    case 'after':
      return { since: preciseDate(value, 'after', supportsWithin) };
    case 'before':
      return { before: preciseDate(value, 'before', supportsWithin) };
    case 'label':
      if (supportsGmailRaw) return { gmraw: `label:${gmailQuote(value)}` };
      throw new EmailError('unsupported_capability', 'Label search requires a Gmail-compatible IMAP server');
    case 'folder':
      if (supportsGmailRaw) return { gmraw: `in:${gmailQuote(value)}` };
      throw new EmailError('unsupported_capability', 'Boolean folder search is not supported by this IMAP server');
    case 'has_attachment':
      if (supportsGmailRaw) return { gmraw: expression.value ? 'has:attachment' : '-has:attachment' };
      throw new EmailError(
        'unsupported_capability',
        'Nested attachment search requires a Gmail-compatible IMAP server',
      );
    case 'filename':
      if (supportsGmailRaw) return { gmraw: `filename:${gmailQuote(value)}` };
      throw new EmailError('unsupported_capability', 'Filename search requires a Gmail-compatible IMAP server');
    case 'filetype':
      if (supportsGmailRaw) return { gmraw: `filename:${gmailQuote(value.replace(/^\./, ''))}` };
      throw new EmailError('unsupported_capability', 'File type search requires a Gmail-compatible IMAP server');
    case 'account':
      throw new EmailError('invalid_request', 'account filters must be resolved before calling a provider');
  }
}

export function toImapSearch(query: EmailQuery, supportsGmailRaw: boolean, supportsWithin = false): SearchObject {
  const search: SearchObject = { all: true };
  if (query.text) search.text = query.text;
  if (query.from) search.from = query.from;
  if (query.to) search.to = query.to;
  if (query.subject) search.subject = query.subject;
  if (query.read !== undefined) search.seen = query.read;
  else if (query.unreadOnly) search.seen = false;
  if (query.starred !== undefined) search.flagged = query.starred;
  else if (query.starredOnly) search.flagged = true;
  if (query.after) search.since = date(query.after, 'after');
  if (query.before) search.before = date(query.before, 'before');
  if (query.rawProviderQuery) {
    if (!supportsGmailRaw) {
      throw new EmailError('unsupported_capability', 'rawProviderQuery requires an IMAP server with Gmail raw search');
    }
    search.gmraw = query.rawProviderQuery;
  }
  if (query.expression) Object.assign(search, expressionSearch(query.expression, supportsGmailRaw, supportsWithin));
  return search;
}
