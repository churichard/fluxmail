import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCliProgram,
  installStdioShutdownHandler,
  permissionPolicyForUpdate,
  permissionPolicyFromOptions,
  shutdownTelemetryAndLogging,
  waitForServerListening,
} from '../src/cli.js';
import { getLogger } from '../src/logging.js';
import { customPermissionPolicy, permissionPolicyForProfile } from '../src/permissions.js';
import { getTelemetry } from '../src/telemetry.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function telemetrySpy() {
  const capture = vi.fn();
  return { capture, telemetry: { capture, shutdown: vi.fn().mockResolvedValue(undefined) } };
}

describe('CLI telemetry', () => {
  it('keeps config commands available when a stored logging value is invalid', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-logging-recovery-'));
    writeFileSync(path.join(dataDir, 'config.env'), 'FLUXMAIL_LOG_LEVEL="debug"\n');
    vi.stubEnv('FLUXMAIL_DATA_DIR', dataDir);
    const previousLogLevel = process.env.FLUXMAIL_LOG_LEVEL;
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { capture, telemetry } = telemetrySpy();

    try {
      await createCliProgram({ telemetry }).parseAsync([
        'node',
        'fluxmail',
        'config',
        'set',
        'FLUXMAIL_LOG_LEVEL',
        'info',
      ]);

      expect(readFileSync(path.join(dataDir, 'config.env'), 'utf8')).toContain('FLUXMAIL_LOG_LEVEL="info"');
      expect(output).toHaveBeenCalled();
      expect(capture).toHaveBeenCalledWith(
        'operation completed',
        expect.objectContaining({ product_surface: 'cli', operation: 'config set', outcome: 'success' }),
      );
    } finally {
      if (previousLogLevel === undefined) delete process.env.FLUXMAIL_LOG_LEVEL;
      else process.env.FLUXMAIL_LOG_LEVEL = previousLogLevel;
    }
  });

  it('flushes local logs when a stdio stream ends', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-stdio-logging-'));
    const input = new PassThrough();
    const logger = getLogger(dataDir, 'stdio', { level: 'info', destination: 'file' });
    installStdioShutdownHandler(input);
    logger.error('mcp.operation_failed', 'Final request failed', new Error('provider unavailable'));

    input.resume();
    input.end();

    const logFile = path.join(dataDir, 'logs', 'fluxmail.jsonl');
    await vi.waitFor(() => expect(readFileSync(logFile, 'utf8')).toContain('mcp.operation_failed'));
  });

  it('flushes local logs while telemetry waits for an active operation', async () => {
    await shutdownTelemetryAndLogging();
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-signal-logging-'));
    const finishActivity = getTelemetry(dataDir).beginActivity?.();
    const logger = getLogger(dataDir, 'serve', { level: 'info', destination: 'file' });
    logger.error('server.operation_failed', 'Request was interrupted', new Error('provider unavailable'));

    let shutdownFinished = false;
    const shutdown = shutdownTelemetryAndLogging().then(() => {
      shutdownFinished = true;
    });

    const logFile = path.join(dataDir, 'logs', 'fluxmail.jsonl');
    await vi.waitFor(() => expect(readFileSync(logFile, 'utf8')).toContain('server.operation_failed'));
    expect(shutdownFinished).toBe(false);
    logger.error('server.final_failure', 'Active request failed during shutdown', new Error('request interrupted'));

    finishActivity?.();
    await shutdown;
    expect(shutdownFinished).toBe(true);
    expect(readFileSync(logFile, 'utf8')).toContain('server.final_failure');
  });

  it('shows filtered local logs and records only the command telemetry', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-logs-'));
    vi.stubEnv('FLUXMAIL_DATA_DIR', dataDir);
    const logDir = path.join(dataDir, 'logs');
    mkdirSync(logDir);
    const record = (level: 'info' | 'warn' | 'error', event: string) =>
      JSON.stringify({
        timestamp: '2026-07-19T12:00:00.000Z',
        level,
        event,
        message: `${event} message`,
        version: 'test',
        pid: 1,
        run_id: 'run',
        process_mode: 'serve',
      });
    writeFileSync(
      path.join(logDir, 'fluxmail.jsonl'),
      `${record('info', 'server.started')}\n${record('error', 'server.failed')}\n`,
    );
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { capture, telemetry } = telemetrySpy();

    await createCliProgram({ telemetry }).parseAsync(['node', 'fluxmail', 'logs', '--level', 'error', '--json']);

    expect(output).toHaveBeenCalledTimes(1);
    expect(output).toHaveBeenCalledWith(expect.stringContaining('server.failed'));
    expect(capture).toHaveBeenCalledWith(
      'operation completed',
      expect.objectContaining({ product_surface: 'cli', operation: 'logs', outcome: 'success' }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain('server.failed');
  });

  it('keeps plain local log output on one physical line', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-plain-logs-'));
    vi.stubEnv('FLUXMAIL_DATA_DIR', dataDir);
    const logDir = path.join(dataDir, 'logs');
    mkdirSync(logDir);
    writeFileSync(
      path.join(logDir, 'fluxmail.jsonl'),
      `${JSON.stringify({
        timestamp: '2026-07-19T12:00:00.000Z',
        level: 'error',
        event: 'provider.failed\nforged.event\u001b[2J',
        message: 'First line\r\n2026-01-01 ERROR forged: second line\u0007',
        version: 'test',
        pid: 1,
        run_id: 'run',
        process_mode: 'serve',
      })}\n`,
    );
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { telemetry } = telemetrySpy();

    await createCliProgram({ telemetry }).parseAsync(['node', 'fluxmail', 'logs']);

    expect(output).toHaveBeenCalledTimes(1);
    const line = String(output.mock.calls[0]?.[0]);
    expect(
      [...line].some((character) => {
        const code = character.codePointAt(0)!;
        return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
      }),
    ).toBe(false);
    expect(line).toContain('provider.failed\\nforged.event');
    expect(line).toContain('First line\\r\\n2026-01-01 ERROR forged: second line');
    expect(line).toContain('\\x1b[2J');
    expect(line).toContain('\\x07');
  });

  it('records a safe logs command error without the invalid option value', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.stubEnv('FLUXMAIL_DATA_DIR', mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-logs-error-')));
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { capture, telemetry } = telemetrySpy();

    try {
      await createCliProgram({ telemetry }).parseAsync(['node', 'fluxmail', 'logs', '--tail', 'private-invalid-value']);

      expect(capture).toHaveBeenCalledWith(
        'operation completed',
        expect.objectContaining({
          product_surface: 'cli',
          operation: 'logs',
          outcome: 'error',
          error_code: 'invalid_request',
        }),
      );
      expect(JSON.stringify(capture.mock.calls)).not.toContain('private-invalid-value');
      expect(output).toHaveBeenCalled();
    } finally {
      process.exitCode = previousExitCode;
    }
  });

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

  it('shows an update notice after command output without changing telemetry', async () => {
    vi.stubEnv('FLUXMAIL_DATA_DIR', mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-update-')));
    const events: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => events.push('command output'));
    const notify = vi.fn(() => events.push('update notice'));
    const updateNotifierFactory = vi.fn(() => ({ notify }));
    const { capture, telemetry } = telemetrySpy();

    await createCliProgram({ telemetry, updateNotifierFactory }).parseAsync([
      'node',
      'fluxmail',
      'telemetry',
      'status',
    ]);

    expect(updateNotifierFactory).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    expect(events).toEqual(['command output', 'update notice']);
    expect(capture).toHaveBeenCalledWith('operation completed', {
      product_surface: 'cli',
      operation: 'telemetry status',
      outcome: 'success',
      duration_ms: expect.any(Number),
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain('update');
  });

  it.each([
    ['before the command', ['--no-update-notifier', 'telemetry', 'status']],
    ['after the command', ['telemetry', 'status', '--no-update-notifier']],
  ])('supports the update opt-out flag %s', async (_name, args) => {
    vi.stubEnv('FLUXMAIL_DATA_DIR', mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-update-')));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const updateNotifierFactory = vi.fn(() => ({ notify: vi.fn() }));
    const { capture, telemetry } = telemetrySpy();

    await createCliProgram({ telemetry, updateNotifierFactory }).parseAsync(['node', 'fluxmail', ...args]);

    expect(updateNotifierFactory).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('operation completed', {
      product_surface: 'cli',
      operation: 'telemetry status',
      outcome: 'success',
      duration_ms: expect.any(Number),
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain('no-update-notifier');
  });

  it('does not create an update notifier for stdio MCP', async () => {
    vi.stubEnv('FLUXMAIL_DATA_DIR', mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-update-')));
    const updateNotifierFactory = vi.fn(() => ({ notify: vi.fn() }));
    const { telemetry } = telemetrySpy();

    await expect(
      createCliProgram({ telemetry, updateNotifierFactory }).parseAsync(['node', 'fluxmail', 'stdio']),
    ).rejects.toThrow();

    expect(updateNotifierFactory).not.toHaveBeenCalled();
  });

  it('does not fail the command when an update notice cannot be displayed', async () => {
    vi.stubEnv('FLUXMAIL_DATA_DIR', mkdtempSync(path.join(tmpdir(), 'fluxmail-cli-update-')));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const updateNotifierFactory = vi.fn(() => ({
      notify: vi.fn(() => {
        throw new Error('private terminal failure');
      }),
    }));
    const { capture, telemetry } = telemetrySpy();

    await createCliProgram({ telemetry, updateNotifierFactory }).parseAsync([
      'node',
      'fluxmail',
      'telemetry',
      'status',
    ]);

    expect(capture).toHaveBeenCalledWith('operation completed', {
      product_surface: 'cli',
      operation: 'telemetry status',
      outcome: 'success',
      duration_ms: expect.any(Number),
    });
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
