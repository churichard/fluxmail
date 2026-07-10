import type { EmailAddress } from './types.js';

/** Parse an RFC 5322 address list ("Ann <a@x.com>, b@y.com") into structured addresses. */
export function parseAddressList(raw: string | undefined): EmailAddress[] {
  if (!raw) return [];
  const out: EmailAddress[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = '';
  const flush = () => {
    const addr = parseSingleAddress(current.trim());
    if (addr) out.push(addr);
    current = '';
  };
  for (const ch of raw) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '(') depth++;
    else if (!inQuotes && ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && !inQuotes && depth === 0) flush();
    else current += ch;
  }
  flush();
  return out;
}

export function parseSingleAddress(raw: string): EmailAddress | null {
  if (!raw) return null;
  const angled = raw.match(/^\s*(?:"?([^"]*)"?\s+)?<([^>]+)>\s*$/);
  if (angled?.[2]) {
    const name = angled[1]?.trim();
    return { email: angled[2].trim(), ...(name ? { name } : {}) };
  }
  const bare = raw.match(/[^\s<>,;]+@[^\s<>,;]+/);
  if (bare) return { email: bare[0] };
  return null;
}
