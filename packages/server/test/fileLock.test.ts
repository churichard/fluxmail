import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { withFileLock } from '../src/storage/fileLock.js';

const runFile = promisify(execFile);
const fileLockModuleUrl = new URL('../src/storage/fileLock.ts', import.meta.url).href;

describe('file lock', () => {
  it('does not remove a replacement lock owned by another operation', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fluxmail-file-lock-'));
    const lockPath = path.join(directory, 'operation.lock');
    const replacement = {
      token: 'replacement-owner',
      pid: process.pid,
      hostname: hostname(),
      createdAt: Date.now(),
    };

    withFileLock(lockPath, { timeoutMs: 1_000, staleMs: 30_000, description: 'the test operation' }, () => {
      rmSync(lockPath);
      writeFileSync(lockPath, JSON.stringify(replacement), { mode: 0o600 });
    });

    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toEqual(replacement);
    rmSync(lockPath);
  });

  it('serializes processes that recover the same abandoned lock', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fluxmail-file-lock-'));
    const lockPath = path.join(directory, 'operation.lock');
    const criticalSectionPath = path.join(directory, 'critical-section');
    writeFileSync(
      lockPath,
      JSON.stringify({ token: 'abandoned-owner', pid: 99_999_999, hostname: hostname(), createdAt: 0 }),
      { mode: 0o600 },
    );
    const script = `
      import { mkdirSync, rmdirSync } from 'node:fs';
      import { withFileLock } from ${JSON.stringify(fileLockModuleUrl)};
      const waitArray = new Int32Array(new SharedArrayBuffer(4));
      withFileLock(
        process.argv[1],
        { timeoutMs: 5_000, staleMs: 30_000, description: 'the test operation' },
        () => {
          mkdirSync(process.argv[2]);
          Atomics.wait(waitArray, 0, 0, 50);
          rmdirSync(process.argv[2]);
        },
      );
    `;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        runFile(process.execPath, [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          script,
          lockPath,
          criticalSectionPath,
        ]),
      ),
    );

    expect(readdirSync(directory)).toEqual([]);
  });
});
