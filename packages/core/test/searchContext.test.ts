import { describe, expect, it } from 'vitest';
import { extractSearchContext, SEARCH_CONTEXT_INPUT_LIMIT, SEARCH_CONTEXT_OUTPUT_LIMIT } from '../src/searchContext.js';

describe('extractSearchContext', () => {
  it('prefers a complete phrase over an earlier individual term', () => {
    expect(
      extractSearchContext(
        { text: 'invoice appears here\nThe final invoice [ABC-123] is ready.' },
        'invoice [ABC-123]',
      ),
    ).toEqual({
      status: 'matched',
      excerpt: 'The final invoice [ABC-123] is ready.',
    });
  });

  it('falls back to the earliest literal term while preserving punctuation', () => {
    expect(extractSearchContext({ text: 'Nothing here\nUse [ORDER_ID] when replying.' }, '[ORDER_ID] later')).toEqual({
      status: 'matched',
      excerpt: 'Use [ORDER_ID] when replying.',
    });
  });

  it('extracts readable text from HTML-only bodies', () => {
    expect(
      extractSearchContext(
        { html: '<style>.hidden{}</style><p>First line</p><p>Payment &amp; invoice [42]</p>' },
        'invoice [42]',
      ),
    ).toEqual({ status: 'matched', excerpt: 'Payment & invoice [42]' });
  });

  it('distinguishes a complete miss from a scan-limited miss', () => {
    expect(extractSearchContext({ text: 'No matching text.' }, 'needle')).toEqual({ status: 'no_literal_match' });
    expect(extractSearchContext({ text: `${'a'.repeat(SEARCH_CONTEXT_INPUT_LIMIT)}needle` }, 'needle')).toEqual({
      status: 'scan_limit',
    });
  });

  it('crops long Unicode lines around the match', () => {
    const result = extractSearchContext({ text: `${'🙂 word '.repeat(80)}[MATCH]${' tail'.repeat(80)}` }, '[match]');
    expect(result.status).toBe('matched');
    if (result.status !== 'matched') return;
    expect(result.excerpt).toContain('[MATCH]');
    expect([...result.excerpt].length).toBeLessThanOrEqual(SEARCH_CONTEXT_OUTPUT_LIMIT);
    expect(result.excerpt.startsWith('…')).toBe(true);
    expect(result.excerpt.endsWith('…')).toBe(true);
  });

  it('reports unavailable when no readable body part exists', () => {
    expect(extractSearchContext({}, 'needle')).toEqual({ status: 'unavailable' });
  });
});
