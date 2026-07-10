import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from '../src/config.js';

const KEYS = ['FM_TEST_A', 'FM_TEST_B', 'FM_TEST_C', 'FM_TEST_QUOTED', 'FM_TEST_EXPORT'];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

function tempEnvDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'fluxmail-dotenv-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

describe('loadDotEnv', () => {
  it('loads variables from .env', () => {
    const dir = tempEnvDir({ '.env': 'FM_TEST_A=hello\n# comment\n\nFM_TEST_B="quoted value"\n' });
    loadDotEnv(dir);
    expect(process.env.FM_TEST_A).toBe('hello');
    expect(process.env.FM_TEST_B).toBe('quoted value');
  });

  it('.env.local wins over .env', () => {
    const dir = tempEnvDir({
      '.env': 'FM_TEST_A=from-env\nFM_TEST_C=only-env\n',
      '.env.local': 'FM_TEST_A=from-local\n',
    });
    loadDotEnv(dir);
    expect(process.env.FM_TEST_A).toBe('from-local');
    expect(process.env.FM_TEST_C).toBe('only-env');
  });

  it('real environment variables win over both files', () => {
    process.env.FM_TEST_A = 'from-shell';
    const dir = tempEnvDir({ '.env': 'FM_TEST_A=from-env\n', '.env.local': 'FM_TEST_A=from-local\n' });
    loadDotEnv(dir);
    expect(process.env.FM_TEST_A).toBe('from-shell');
  });

  it('handles export prefixes and single quotes', () => {
    const dir = tempEnvDir({ '.env': "export FM_TEST_EXPORT=yes\nFM_TEST_QUOTED='single'\n" });
    loadDotEnv(dir);
    expect(process.env.FM_TEST_EXPORT).toBe('yes');
    expect(process.env.FM_TEST_QUOTED).toBe('single');
  });

  it('is a no-op when no files exist', () => {
    expect(() => loadDotEnv(tempEnvDir({}))).not.toThrow();
  });
});
