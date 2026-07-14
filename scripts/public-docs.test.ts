import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parseManifest, replaceGeneratedSection } from './public-docs.js';

const manifest = { schemaVersion: 1, id: 'fluxmail-mcp', category: 'Fluxmail MCP', pages: ['quickstart'] };

describe('public docs bundle validation', () => {
  it('parses a valid manifest without changing its order', () => {
    expect(parseManifest(manifest).pages).toEqual(['quickstart']);
  });

  it('rejects unsafe paths and duplicate slugs', () => {
    expect(() => parseManifest({ ...manifest, pages: ['../secret'] })).toThrow(/unsafe|invalid/);
    expect(() => parseManifest({ ...manifest, pages: ['quickstart', 'quickstart'] })).toThrow(/duplicate/);
  });

  it('requires the public frontmatter contract', () => {
    expect(
      parseFrontmatter("---\ntitle: 'Test'\ndescription: 'A page'\nupdated: '2026-07-14'\ndraft: false\n---\n"),
    ).toMatchObject({
      title: 'Test',
      draft: false,
    });
    expect(() => parseFrontmatter("---\ntitle: 'Test'\ndescription: 'A page'\nupdated: '2026-02-30'\n---\n")).toThrow(
      /updated date/,
    );
    expect(() => parseFrontmatter("---\ntitle: 'Test'\ncategory: 'Wrong owner'\n---\n")).toThrow();
  });

  it('updates only a marked generated section', () => {
    expect(
      replaceGeneratedSection(
        'before\n<!-- BEGIN GENERATED:test -->\nold\n<!-- END GENERATED:test -->\nafter',
        'test',
        'new',
      ),
    ).toBe('before\n<!-- BEGIN GENERATED:test -->\nnew\n<!-- END GENERATED:test -->\nafter');
  });
});
