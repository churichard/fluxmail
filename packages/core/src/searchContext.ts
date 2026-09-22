import type { Message } from './types.js';

export const SEARCH_CONTEXT_INPUT_LIMIT = 256 * 1024;
export const SEARCH_CONTEXT_OUTPUT_LIMIT = 300;

export interface BoundedBodyText {
  text: string;
  complete: boolean;
}

const BLOCK_END =
  /<\/(?:address|article|aside|blockquote|div|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)>/gi;

function decodeCodePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : fallback;
}

export function htmlToReadableText(value: string): string {
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(BLOCK_END, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (match, value: string) => decodeCodePoint(Number(value), match))
    .replace(/&#x([\da-f]+);/gi, (match, value: string) => decodeCodePoint(Number.parseInt(value, 16), match));
}

/** Limit decoded content by UTF-8 bytes without splitting a Unicode code point. */
export function boundBodyText(value: string, limit = SEARCH_CONTEXT_INPUT_LIMIT): BoundedBodyText {
  if (Buffer.byteLength(value) <= limit) return { text: value, complete: true };
  let size = 0;
  let text = '';
  for (const character of value) {
    const bytes = Buffer.byteLength(character);
    if (size + bytes > limit) break;
    text += character;
    size += bytes;
  }
  return { text, complete: false };
}

function readableLines(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t\f\v ]+/gu, ' ').trim())
    .filter(Boolean);
}

function cropLine(line: string, matchIndex: number, matchLength: number): string {
  const characters = [...line];
  if (characters.length <= SEARCH_CONTEXT_OUTPUT_LIMIT) return line;

  const matchStart = Array.from(line.slice(0, matchIndex)).length;
  const matchedCharacters = Array.from(line.slice(matchIndex, matchIndex + matchLength)).length;
  const prefixMarker = matchStart > 0 ? 1 : 0;
  const suffixMarker = matchStart + matchedCharacters < characters.length ? 1 : 0;
  const available = SEARCH_CONTEXT_OUTPUT_LIMIT - prefixMarker - suffixMarker;
  let start = Math.max(0, matchStart - Math.floor((available - matchedCharacters) / 2));
  let end = Math.min(characters.length, start + available);
  start = Math.max(0, end - available);

  if (start > 0) {
    const nextSpace = characters.slice(start, matchStart).findIndex((character) => /\s/u.test(character));
    if (nextSpace >= 0) start += nextSpace + 1;
  }
  if (end < characters.length) {
    for (let index = end - 1; index >= matchStart + matchedCharacters; index -= 1) {
      if (/\s/u.test(characters[index]!)) {
        end = index;
        break;
      }
    }
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < characters.length ? '…' : '';
  return `${prefix}${characters.slice(start, end).join('').trim()}${suffix}`;
}

function findMatch(line: string, queryText: string): { index: number; length: number } | undefined {
  const foldedLine = line.toLowerCase();
  const phrase = queryText.trim().replace(/\s+/gu, ' ');
  const phraseIndex = foldedLine.indexOf(phrase.toLowerCase());
  if (phraseIndex >= 0) return { index: phraseIndex, length: phrase.length };

  let earliest: { index: number; length: number } | undefined;
  for (const term of phrase.split(/\s+/u).filter(Boolean)) {
    const index = foldedLine.indexOf(term.toLowerCase());
    if (index >= 0 && (!earliest || index < earliest.index)) earliest = { index, length: term.length };
  }
  return earliest;
}

export function extractSearchContext(
  body: { text?: string; html?: string },
  queryText: string,
  options: { complete?: boolean } = {},
): NonNullable<Message['searchContext']> {
  const raw = body.text !== undefined ? body.text : body.html;
  if (raw === undefined) return { status: 'unavailable' };
  const bounded = boundBodyText(raw);
  const selected = body.text !== undefined ? bounded.text : htmlToReadableText(bounded.text);
  const complete = (options.complete ?? true) && bounded.complete;
  let best: { line: string; index: number; length: number } | undefined;
  let fallback: { line: string; index: number; length: number; position: number } | undefined;
  const phrase = queryText.trim().replace(/\s+/gu, ' ');
  let position = 0;
  for (const line of readableLines(selected)) {
    const foldedLine = line.toLowerCase();
    const phraseIndex = foldedLine.indexOf(phrase.toLowerCase());
    if (phraseIndex >= 0) {
      best = { line, index: phraseIndex, length: phrase.length };
      break;
    }
    const termMatch = findMatch(line, phrase);
    if (termMatch && (!fallback || position + termMatch.index < fallback.position)) {
      fallback = { line, ...termMatch, position: position + termMatch.index };
    }
    position += line.length + 1;
  }

  const match = best ?? fallback;
  if (match) return { status: 'matched', excerpt: cropLine(match.line, match.index, match.length) };
  return { status: complete ? 'no_literal_match' : 'scan_limit' };
}
