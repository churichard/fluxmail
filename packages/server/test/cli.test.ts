import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCliProgram, permissionPolicyForUpdate, permissionPolicyFromOptions, runCli } from '../src/cli.js';
import { customPermissionPolicy, permissionPolicyForProfile } from '../src/permissions.js';

const originalDataDir = process.env.FLUXMAIL_DATA_DIR;
const originalDoNotTrack = process.env.DO_NOT_TRACK;
const originalExitCode = process.exitCode;

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.FLUXMAIL_DATA_DIR;
  else process.env.FLUXMAIL_DATA_DIR = originalDataDir;
  if (originalDoNotTrack === undefined) delete process.env.DO_NOT_TRACK;
  else process.env.DO_NOT_TRACK = originalDoNotTrack;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe('API key permission options', () => {
  it('preserves the named mail profile when changing only admin capabilities', () => {
    expect(
      permissionPolicyForUpdate({ allow: [], admin: ['admin.accounts'] }, { permissionProfile: 'read-only' }),
    ).toEqual(permissionPolicyForProfile('read-only', ['admin.accounts']));

    expect(
      permissionPolicyForUpdate(
        { profile: 'full', allow: [], admin: ['admin.accounts'] },
        { permissionProfile: 'read-only' },
      ),
    ).toEqual(permissionPolicyForProfile('full', ['admin.accounts']));
  });

  it('requires a complete allowlist when changing a custom policy', () => {
    expect(() =>
      permissionPolicyForUpdate({ allow: [], admin: ['admin.accounts'] }, { permissionProfile: 'custom' }),
    ).toThrow('This key uses a custom policy. Pass every capability with --allow.');

    expect(
      permissionPolicyForUpdate({ allow: ['mail.read', 'admin.accounts'], admin: [] }, { permissionProfile: 'custom' }),
    ).toEqual(customPermissionPolicy(['mail.read', 'admin.accounts']));
  });

  it('requires at least one permission option when updating a key', () => {
    expect(() => permissionPolicyForUpdate({ allow: [], admin: [] }, { permissionProfile: 'read-only' })).toThrow(
      'Choose --profile, --admin, or at least one --allow capability.',
    );
  });

  it('keeps full as the default mail profile when creating an administrative key', () => {
    expect(permissionPolicyFromOptions({ allow: [], admin: ['admin.accounts'] })).toEqual(
      permissionPolicyForProfile('full', ['admin.accounts']),
    );
  });
});

describe('status command', () => {
  it('reports the engine, data directory, and compatible store format', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-status-'));
    process.env.FLUXMAIL_DATA_DIR = dataDir;
    process.env.DO_NOT_TRACK = '1';
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line) => output.push(String(line)));

    await createCliProgram().parseAsync(['node', 'fluxmail', 'status']);

    const status = JSON.parse(output.at(-1)!) as Record<string, unknown>;
    expect(status).toMatchObject({
      version: '0.3.0',
      dataDir,
      databasePath: path.join(dataDir, 'fluxmail.db'),
      store: {
        storeFormat: 1,
        minimumSupportedFormat: 1,
        maximumSupportedFormat: 1,
        compatible: true,
      },
    });
  });

  it('exits without changing a store from a newer Fluxmail version', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-status-'));
    const dbPath = path.join(dataDir, 'fluxmail.db');
    const db = new Database(dbPath);
    db.pragma('user_version = 2');
    db.close();
    process.env.FLUXMAIL_DATA_DIR = dataDir;
    process.env.DO_NOT_TRACK = '1';
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => errors.push(String(line)));

    await runCli(['node', 'fluxmail', 'status']);

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('store format 2');
    expect(existsSync(path.join(dataDir, 'encryption.key'))).toBe(false);
  });
});
