import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInitialAdmin } from '../src/auth.js';
import { createCliProgram } from '../src/cli.js';
import { saveLocalInstance, saveRemoteInstance, saveSessionToken, useInstance } from '../src/cliInstances.js';
import * as contextModule from '../src/context.js';
import type { AppContext } from '../src/context.js';
import { LicenseController } from '../src/licensing/refresher.js';
import { shutdownLogging } from '../src/logging.js';
import { SendScheduler } from '../src/scheduler/sendScheduler.js';

describe('CLI stdio startup', () => {
  let dataDir: string;
  const contexts: AppContext[] = [];
  let originalSignalListeners: Map<NodeJS.Signals, ReturnType<typeof process.listeners>>;
  let originalEndListeners: ReturnType<typeof process.stdin.listeners>;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-stdio-'));
    vi.stubEnv('FLUXMAIL_DATA_DIR', dataDir);
    vi.stubEnv('FLUXMAIL_ENCRYPTION_KEY', 'ba'.repeat(32));
    vi.stubEnv('FLUXMAIL_TELEMETRY', '0');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(McpServer.prototype, 'connect').mockResolvedValue();
    vi.spyOn(SendScheduler.prototype, 'start').mockImplementation(() => {});
    vi.spyOn(LicenseController.prototype, 'start').mockImplementation(() => {});
    const createContext = contextModule.createContext;
    vi.spyOn(contextModule, 'createContext').mockImplementation((options) => {
      const context = createContext(options);
      contexts.push(context);
      return context;
    });
    originalSignalListeners = new Map(
      (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => [signal, process.listeners(signal)]),
    );
    originalEndListeners = process.stdin.listeners('end');
  });

  afterEach(async () => {
    for (const context of contexts.splice(0)) {
      context.scheduler.stop();
      context.licenseController.stop();
      await context.registry.close();
      const client = (context.db as unknown as { $client: { open: boolean; close(): void } }).$client;
      if (client.open) client.close();
    }
    for (const [signal, listeners] of originalSignalListeners) {
      for (const listener of process.listeners(signal)) {
        if (!listeners.includes(listener)) process.removeListener(signal, listener);
      }
    }
    for (const listener of process.stdin.listeners('end')) {
      if (!originalEndListeners.includes(listener)) process.stdin.removeListener('end', listener);
    }
    await shutdownLogging();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function localSession(): Promise<string> {
    const context = contextModule.createContext();
    const setup = await setupInitialAdmin(context.db, {
      name: 'Private Owner',
      email: 'private-owner@example.com',
      password: 'River42!',
    });
    saveLocalInstance();
    saveSessionToken('local', setup.session.token);
    return setup.session.token;
  }

  function invocation(args: string[] = []) {
    const capture = vi.fn();
    const telemetry = { capture, shutdown: vi.fn().mockResolvedValue(undefined) };
    const program = createCliProgram({ telemetry });
    const run = () => program.parseAsync(['node', 'fluxmail', ...args]);
    return { capture, run };
  }

  function expectEvent(capture: ReturnType<typeof vi.fn>, outcome: string, phase: string, errorCode?: string): void {
    expect(capture.mock.calls).toEqual([
      [
        'operation completed',
        {
          product_surface: 'cli',
          operation: 'stdio',
          outcome,
          startup_phase: phase,
          duration_ms: expect.any(Number),
          ...(errorCode ? { error_code: errorCode } : {}),
        },
      ],
    ]);
    const properties = JSON.stringify(capture.mock.calls);
    for (const privateInput of [
      dataDir,
      'private-owner@example.com',
      'River42!',
      'private-invalid',
      'private-work',
      'private.example.com',
      'fms_private-remote-token',
    ]) {
      expect(properties).not.toContain(privateInput);
    }
  }

  it.each([
    ['--profile', 'private-invalid'],
    ['--allow', 'private-invalid'],
    ['--profile', 'read-only', '--allow', 'private-invalid'],
  ])('reports invalid permission options as invalid requests before opening the store: %j', async (...options) => {
    const { capture, run } = invocation(['stdio', ...options]);

    await expect(run()).rejects.toMatchObject({ code: 'invalid_request' });

    expectEvent(capture, 'error', 'permissions', 'invalid_request');
    expect(contextModule.createContext).not.toHaveBeenCalled();
    expect(existsSync(path.join(dataDir, 'fluxmail.db'))).toBe(false);
  });

  it('records unconfigured instances without creating a store', async () => {
    const { capture, run } = invocation(['stdio']);
    await expect(run()).rejects.toMatchObject({ code: 'invalid_request' });
    expectEvent(capture, 'error', 'instance', 'invalid_request');
    expect(contextModule.createContext).not.toHaveBeenCalled();
  });

  it('requires a local login without initializing an unused store', async () => {
    saveLocalInstance();
    const { capture, run } = invocation(['stdio']);
    await expect(run()).rejects.toMatchObject({ code: 'permission_denied' });
    expectEvent(capture, 'error', 'authentication', 'permission_denied');
    expect(contextModule.createContext).not.toHaveBeenCalled();
  });

  it('rejects an invalid local session and closes the context', async () => {
    await localSession();
    saveSessionToken('local', 'fms_private-invalid');
    const { capture, run } = invocation(['stdio']);
    await expect(run()).rejects.toMatchObject({ code: 'permission_denied' });
    expectEvent(capture, 'error', 'authentication', 'permission_denied');
    expect((contexts.at(-1)!.db as unknown as { $client: { open: boolean } }).$client.open).toBe(false);
    expect(McpServer.prototype.connect).not.toHaveBeenCalled();
  });

  it('identifies configuration failures without sending configuration values', async () => {
    await localSession();
    vi.stubEnv('FLUXMAIL_ENCRYPTION_KEY', 'private-invalid-key');
    const { capture, run } = invocation(['stdio']);
    await expect(run()).rejects.toThrow(/FLUXMAIL_ENCRYPTION_KEY/);
    expectEvent(capture, 'error', 'context', 'internal');
    expect(McpServer.prototype.connect).not.toHaveBeenCalled();
  });

  it('records account scope errors without capturing the account reference', async () => {
    const token = await localSession();
    const { capture, run } = invocation(['stdio', '--account', 'private-invalid-account']);
    await expect(run()).rejects.toMatchObject({ code: 'not_found' });
    expectEvent(capture, 'error', 'account_scope', 'not_found');
    expect(JSON.stringify(capture.mock.calls)).not.toContain(token);
    expect(McpServer.prototype.connect).not.toHaveBeenCalled();
  });

  it('starts with the authenticated local session even when the active instance is remote', async () => {
    const token = await localSession();
    saveRemoteInstance('private-work', 'https://private.example.com');
    saveSessionToken('private-work', 'fms_private-remote-token');
    useInstance('private-work');
    const { capture, run } = invocation(['stdio', '--profile', 'read-only']);

    await run();

    expectEvent(capture, 'success', 'ready');
    expect(JSON.stringify(capture.mock.calls)).not.toContain(token);
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private');
    expect(McpServer.prototype.connect).toHaveBeenCalledOnce();
    expect(SendScheduler.prototype.start).toHaveBeenCalledOnce();
    expect(LicenseController.prototype.start).toHaveBeenCalledOnce();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects an explicitly selected remote instance before opening a local store', async () => {
    saveRemoteInstance('private-work', 'https://private.example.com');
    saveSessionToken('private-work', 'fms_private-remote-token');
    const { capture, run } = invocation(['--instance', 'private-work', 'stdio']);
    await expect(run()).rejects.toMatchObject({ code: 'invalid_request' });
    expectEvent(capture, 'error', 'instance', 'invalid_request');
    expect(contextModule.createContext).not.toHaveBeenCalled();
  });

  it('records transport failures and closes the context without starting background work', async () => {
    await localSession();
    vi.mocked(McpServer.prototype.connect).mockRejectedValue(new Error('private-invalid-transport'));
    const close = vi.spyOn(McpServer.prototype, 'close');
    const { capture, run } = invocation(['stdio']);

    await expect(run()).rejects.toThrow('private-invalid-transport');

    expectEvent(capture, 'error', 'transport', 'internal');
    expect(close).toHaveBeenCalledOnce();
    expect(SendScheduler.prototype.start).not.toHaveBeenCalled();
    expect(LicenseController.prototype.start).not.toHaveBeenCalled();
    expect((contexts.at(-1)!.db as unknown as { $client: { open: boolean } }).$client.open).toBe(false);
  });
});
