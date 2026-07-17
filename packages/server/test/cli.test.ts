import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCliProgram,
  permissionPolicyForUpdate,
  permissionPolicyFromOptions,
  runCli,
  waitForServerListening,
} from '../src/cli.js';
import { customPermissionPolicy, permissionPolicyForProfile } from '../src/permissions.js';
import { VERSION } from '../src/version.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function telemetrySpy() {
  const capture = vi.fn();
  return { capture, telemetry: { capture, shutdown: vi.fn().mockResolvedValue(undefined) } };
}

describe('CLI telemetry', () => {
  it('rejects server startup errors before the command can be recorded as successful', async () => {
    const startupError = new Error('address already in use');
    const server = createServer();
    const listening = waitForServerListening(server);

    server.emit('error', startupError);

    await expect(listening).rejects.toBe(startupError);
  });

  it('records successful commands with the shared operation schema', async () => {
    vi.stubEnv('FLUXMAIL_DATA_DIR', mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-telemetry-')));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { capture, telemetry } = telemetrySpy();

    await createCliProgram({ telemetry }).parseAsync(['node', 'fluxmail', 'telemetry', 'status']);

    expect(capture).toHaveBeenCalledWith('operation completed', {
      product_surface: 'cli',
      operation: 'telemetry status',
      outcome: 'success',
      duration_ms: expect.any(Number),
    });
    expect(log).toHaveBeenCalled();
  });

  it('records command failures without arguments or error text', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { capture, telemetry } = telemetrySpy();

    try {
      await createCliProgram({ telemetry }).parseAsync(['node', 'fluxmail', 'license', 'activate', 'private-key']);

      expect(capture).toHaveBeenCalledWith('operation completed', {
        product_surface: 'cli',
        operation: 'license activate',
        outcome: 'error',
        error_code: 'command_failed',
        duration_ms: expect.any(Number),
      });
      expect(JSON.stringify(capture.mock.calls)).not.toContain('private-key');
      expect(error).toHaveBeenCalled();
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('records a safe error code when account setup rejects a provider', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { capture, telemetry } = telemetrySpy();

    try {
      await createCliProgram({ telemetry }).parseAsync([
        'node',
        'fluxmail',
        'accounts',
        'add',
        'private-provider-value',
      ]);

      expect(capture).toHaveBeenCalledWith('operation completed', {
        product_surface: 'cli',
        operation: 'accounts add',
        outcome: 'error',
        error_code: 'invalid_request',
        duration_ms: expect.any(Number),
      });
      expect(JSON.stringify(capture.mock.calls)).not.toContain('private-provider-value');
      expect(error).toHaveBeenCalled();
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('does not record the telemetry disable command', async () => {
    vi.stubEnv('FLUXMAIL_DATA_DIR', mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-telemetry-')));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { capture, telemetry } = telemetrySpy();

    await createCliProgram({ telemetry }).parseAsync(['node', 'fluxmail', 'telemetry', 'disable']);

    expect(capture).not.toHaveBeenCalled();
  });
});

describe('status command', () => {
  it('reports the engine, data directory, and compatible store format', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-status-'));
    vi.stubEnv('FLUXMAIL_DATA_DIR', dataDir);
    vi.stubEnv('DO_NOT_TRACK', '1');
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line) => output.push(String(line)));

    await createCliProgram({ telemetry: telemetrySpy().telemetry }).parseAsync(['node', 'fluxmail', 'status']);

    const status = JSON.parse(output.at(-1)!) as Record<string, unknown>;
    expect(status).toMatchObject({
      version: VERSION,
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

  it('exits without generating a key for a store from a newer Fluxmail version', async () => {
    const previousExitCode = process.exitCode;
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-status-'));
    const dbPath = path.join(dataDir, 'fluxmail.db');
    const db = new Database(dbPath);
    db.pragma('user_version = 2');
    db.close();
    vi.stubEnv('FLUXMAIL_DATA_DIR', dataDir);
    vi.stubEnv('DO_NOT_TRACK', '1');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => errors.push(String(line)));

    try {
      process.exitCode = undefined;
      await runCli(['node', 'fluxmail', 'status']);

      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toContain('store format 2');
      expect(existsSync(path.join(dataDir, 'encryption.key'))).toBe(false);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
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
