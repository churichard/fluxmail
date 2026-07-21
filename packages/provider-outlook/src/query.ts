import { EmailError, type EmailQuery, type EmailSearchExpression } from '@fluxmail/core';

function quoteKqlClause(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function quoteKqlValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function dateTime(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new EmailError('invalid_request', `${field} must be a valid ISO date`);
  return date.toISOString();
}

function compileExpression(expression: EmailSearchExpression): string {
  if (expression.type === 'all') return '';
  if (expression.type === 'none') return 'subject:"__fluxmail_no_matching_message__"';
  if (expression.type === 'text') return quoteKqlValue(expression.value);
  if (expression.type === 'and' || expression.type === 'or') {
    const operands = expression.operands.map(compileExpression).filter(Boolean);
    if (!operands.length) return '';
    const joined = operands.join(` ${expression.type.toUpperCase()} `);
    return operands.length > 1 ? `(${joined})` : joined;
  }
  if (expression.type === 'not') {
    const operand = compileExpression(expression.operand);
    return operand ? `NOT (${operand})` : 'subject:"__fluxmail_no_matching_message__"';
  }
  const value = String(expression.value);
  switch (expression.field) {
    case 'from':
    case 'to':
    case 'cc':
    case 'bcc':
    case 'subject':
      return `${expression.field}:${quoteKqlValue(value)}`;
    case 'label':
      return `category:${quoteKqlValue(value)}`;
    case 'has_attachment':
      return `hasAttachments:${expression.value ? 'true' : 'false'}`;
    case 'after':
      return `received>=${dateTime(value, 'after')}`;
    case 'before':
      return `received<${dateTime(value, 'before')}`;
    case 'filename':
      return `attachment:${quoteKqlValue(value)}`;
    case 'filetype':
      return `attachment:${quoteKqlValue(value.replace(/^\./, ''))}`;
    case 'folder':
      throw new EmailError('unsupported_capability', 'Boolean folder expressions are not supported by Microsoft Graph');
    case 'read':
    case 'starred':
      throw new EmailError(
        'unsupported_capability',
        `Boolean ${expression.field} expressions must be a top-level search filter`,
      );
    case 'account':
      throw new EmailError('invalid_request', 'account filters must be resolved before calling a provider');
  }
}

/** Translate Fluxmail's structured query into Graph KQL and OData filters. */
export function toGraphQuery(q: EmailQuery): { search?: string; filter?: string } {
  if (q.rawProviderQuery && (q.text || q.expression)) {
    throw new EmailError('invalid_request', 'rawProviderQuery cannot be combined with text or expression');
  }
  const kql: string[] = [];
  if (q.rawProviderQuery) kql.push(q.rawProviderQuery);
  else if (q.text) kql.push(q.text);
  if (q.from) kql.push(`from:${quoteKqlValue(q.from)}`);
  if (q.to) kql.push(`to:${quoteKqlValue(q.to)}`);
  if (q.subject) kql.push(`subject:${quoteKqlValue(q.subject)}`);
  if (q.after) kql.push(`received>=${dateTime(q.after, 'after')}`);
  if (q.before) kql.push(`received<${dateTime(q.before, 'before')}`);
  if (q.expression) {
    const expression = compileExpression(q.expression);
    if (expression) kql.push(expression);
  }

  const filter: string[] = [];
  if (q.read !== undefined) filter.push(`isRead eq ${q.read ? 'true' : 'false'}`);
  else if (q.unreadOnly) filter.push('isRead eq false');
  if (q.starred !== undefined) filter.push(`flag/flagStatus ${q.starred ? "eq 'flagged'" : "ne 'flagged'"}`);
  else if (q.starredOnly) filter.push("flag/flagStatus eq 'flagged'");
  if (q.hasAttachment !== undefined) filter.push(`hasAttachments eq ${q.hasAttachment ? 'true' : 'false'}`);

  return {
    ...(kql.length ? { search: quoteKqlClause(kql.join(' AND ')) } : {}),
    ...(filter.length ? { filter: filter.join(' and ') } : {}),
  };
}
