import type { EmailSearchExpression, EmailSearchField } from './types.js';

interface Token {
  type: 'word' | 'phrase' | 'left' | 'right' | 'minus';
  value: string;
}

const FIELD_OPERATORS: Record<string, EmailSearchField> = {
  from: 'from',
  to: 'to',
  cc: 'cc',
  bcc: 'bcc',
  subject: 'subject',
  label: 'label',
  filename: 'filename',
  filetype: 'filetype',
  account: 'account',
};

const DATE_OPERATORS: Record<string, 'after' | 'before'> = {
  after: 'after',
  newer: 'after',
  newer_than: 'after',
  before: 'before',
  older: 'before',
  older_than: 'before',
};

/** Parse the desktop search language into a provider-neutral boolean expression. */
export function parseEmailSearch(input: string, now: Date = new Date()): EmailSearchExpression | undefined {
  const tokens = tokenize(input);
  if (!tokens.length) return undefined;
  const parser = new SearchParser(tokens, now);
  return simplifyEmailSearch(parser.parse());
}

export function simplifyEmailSearch(expression: EmailSearchExpression): EmailSearchExpression {
  if (expression.type === 'not') {
    const operand = simplifyEmailSearch(expression.operand);
    if (operand.type === 'all') return { type: 'none' };
    if (operand.type === 'none') return { type: 'all' };
    if (operand.type === 'not') return simplifyEmailSearch(operand.operand);
    return { type: 'not', operand };
  }
  if (expression.type !== 'and' && expression.type !== 'or') return expression;
  const operands = expression.operands
    .map(simplifyEmailSearch)
    .flatMap((operand) => (operand.type === expression.type ? operand.operands : [operand]));
  if (expression.type === 'and') {
    if (operands.some((operand) => operand.type === 'none')) return { type: 'none' };
    const useful = operands.filter((operand) => operand.type !== 'all');
    if (!useful.length) return { type: 'all' };
    if (useful.length === 1) return useful[0]!;
    return { type: 'and', operands: useful };
  }
  if (operands.some((operand) => operand.type === 'all')) return { type: 'all' };
  const useful = operands.filter((operand) => operand.type !== 'none');
  if (!useful.length) return { type: 'none' };
  if (useful.length === 1) return useful[0]!;
  return { type: 'or', operands: useful };
}

class SearchParser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly now: Date,
  ) {}

  parse(): EmailSearchExpression {
    const operands: EmailSearchExpression[] = [];
    while (this.index < this.tokens.length) {
      const before = this.index;
      const expression = this.parseOr();
      if (expression) operands.push(expression);
      if (this.peek()?.type === 'right') this.index += 1;
      if (this.index === before) this.index += 1;
    }
    if (!operands.length) return { type: 'all' };
    return operands.length === 1 ? operands[0]! : { type: 'and', operands };
  }

  private parseOr(): EmailSearchExpression | undefined {
    const operands: EmailSearchExpression[] = [];
    const first = this.parseAnd();
    if (first) operands.push(first);
    while (this.isKeyword('OR')) {
      this.index += 1;
      const next = this.parseAnd();
      if (next) operands.push(next);
    }
    if (!operands.length) return undefined;
    return operands.length === 1 ? operands[0] : { type: 'or', operands };
  }

  private parseAnd(): EmailSearchExpression | undefined {
    const operands: EmailSearchExpression[] = [];
    while (this.index < this.tokens.length && this.peek()?.type !== 'right' && !this.isKeyword('OR')) {
      if (this.isKeyword('AND')) {
        this.index += 1;
        continue;
      }
      const before = this.index;
      const operand = this.parseUnary();
      if (operand) operands.push(operand);
      if (this.index === before) this.index += 1;
    }
    if (!operands.length) return undefined;
    return operands.length === 1 ? operands[0] : { type: 'and', operands };
  }

  private parseUnary(): EmailSearchExpression | undefined {
    if (this.peek()?.type === 'minus' || this.isKeyword('NOT')) {
      this.index += 1;
      const operand = this.parseUnary();
      return operand ? { type: 'not', operand } : undefined;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): EmailSearchExpression | undefined {
    const token = this.peek();
    if (!token) return undefined;
    if (token.type === 'left') {
      this.index += 1;
      const expression = this.parseOr();
      if (this.peek()?.type === 'right') this.index += 1;
      return expression;
    }
    if (token.type === 'right') return undefined;
    this.index += 1;
    if (token.type === 'phrase') return text(token.value, true);
    if (token.type !== 'word') return undefined;
    if (isBooleanKeyword(token.value)) return undefined;
    return this.field(token) ?? text(token.value, false);
  }

  private field(token: Token): EmailSearchExpression | undefined {
    const separator = token.value.indexOf(':');
    if (separator <= 0) return undefined;
    const operator = token.value.slice(0, separator).toLowerCase();
    const isKnown =
      operator in FIELD_OPERATORS ||
      operator in DATE_OPERATORS ||
      operator === 'has' ||
      operator === 'is' ||
      operator === 'in';
    if (!isKnown) return undefined;
    const valueStart = this.index;
    let value = token.value.slice(separator + 1);
    if (!value && (this.peek()?.type === 'word' || this.peek()?.type === 'phrase')) {
      value = this.peek()!.value;
      this.index += 1;
    }
    if (!value) return undefined;
    const field = FIELD_OPERATORS[operator];
    if (field) return { type: 'field', field, value };
    const dateField = DATE_OPERATORS[operator];
    if (dateField) {
      const date = parseSearchDate(value, this.now);
      if (date) return { type: 'field', field: dateField, value: date };
      this.index = valueStart;
      return undefined;
    }
    if (operator === 'has' && value.toLowerCase() === 'attachment')
      return { type: 'field', field: 'has_attachment', value: true };
    if (operator === 'is' || operator === 'in') {
      const normalized = value.toLowerCase();
      if (normalized === 'read') return { type: 'field', field: 'read', value: true };
      if (normalized === 'unread') return { type: 'field', field: 'read', value: false };
      if (normalized === 'starred') return { type: 'field', field: 'starred', value: true };
      return { type: 'field', field: 'folder', value };
    }
    this.index = valueStart;
    return undefined;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private isKeyword(keyword: string): boolean {
    const token = this.peek();
    return token?.type === 'word' && token.value.toUpperCase() === keyword;
  }
}

function text(value: string, exact: boolean): EmailSearchExpression | undefined {
  return value ? { type: 'text', value, exact } : undefined;
}

function isBooleanKeyword(value: string): boolean {
  return ['AND', 'OR', 'NOT'].includes(value.toUpperCase());
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const character = input[index]!;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '(' || character === ')') {
      tokens.push({ type: character === '(' ? 'left' : 'right', value: character });
      index += 1;
      continue;
    }
    if (character === '-' && (index === 0 || /[\s(]/.test(input[index - 1]!))) {
      tokens.push({ type: 'minus', value: character });
      index += 1;
      continue;
    }
    if (character === '"') {
      const phrase = readPhrase(input, index + 1);
      tokens.push({ type: 'phrase', value: phrase.value });
      index = phrase.next;
      continue;
    }
    const start = index;
    while (index < input.length && !/[\s()"]/.test(input[index]!)) index += 1;
    if (index > start) tokens.push({ type: 'word', value: input.slice(start, index) });
  }
  return tokens;
}

function readPhrase(input: string, start: number): { value: string; next: number } {
  let value = '';
  let index = start;
  while (index < input.length) {
    const character = input[index]!;
    if (character === '\\' && index + 1 < input.length) {
      value += input[index + 1]!;
      index += 2;
      continue;
    }
    if (character === '"') return { value, next: index + 1 };
    value += character;
    index += 1;
  }
  return { value, next: index };
}

function parseSearchDate(value: string, now: Date): string | undefined {
  const duration = /^(\d+)([hdwmy])$/i.exec(value);
  if (duration) {
    const amount = Number(duration[1]);
    if (!Number.isSafeInteger(amount) || amount <= 0) return undefined;
    const date = new Date(now);
    const unit = duration[2]!.toLowerCase();
    if (unit === 'h') date.setUTCHours(date.getUTCHours() - amount);
    if (unit === 'd') date.setUTCDate(date.getUTCDate() - amount);
    if (unit === 'w') date.setUTCDate(date.getUTCDate() - amount * 7);
    if (unit === 'm') subtractCalendarMonths(date, amount);
    if (unit === 'y') subtractCalendarYears(date, amount);
    if (!Number.isFinite(date.getTime())) return undefined;
    return date.toISOString();
  }
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const yearSlash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  const usSlash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (iso || yearSlash) {
    const match = iso ?? yearSlash!;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if (usSlash) {
    year = Number(usSlash[3]);
    month = Number(usSlash[1]);
    day = Number(usSlash[2]);
  } else return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

function subtractCalendarMonths(date: Date, amount: number): void {
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - amount);
  if (!Number.isFinite(date.getTime())) return;
  date.setUTCDate(Math.min(day, daysInUtcMonth(date.getUTCFullYear(), date.getUTCMonth())));
}

function subtractCalendarYears(date: Date, amount: number): void {
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCFullYear(date.getUTCFullYear() - amount);
  if (!Number.isFinite(date.getTime())) return;
  date.setUTCDate(Math.min(day, daysInUtcMonth(date.getUTCFullYear(), date.getUTCMonth())));
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
