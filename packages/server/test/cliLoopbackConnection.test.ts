import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailError } from '@fluxmail/core';
import { createCliProgram } from '../src/cli.js';
import { createContext } from '../src/context.js';
import { setupInitialAdmin } from '../src/auth.js';
import { saveLocalInstance, saveSessionToken } from '../src/cliInstances.js';
import { runLoopbackFlow, type AuthorizedOAuthResult } from '../src/accounts/googleAuth.js';

vi.mock('../src/accounts/googleAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/accounts/googleAuth.js')>()),
  runLoopbackFlow: vi.fn(),
}));

const privateCallbackUrl =
  'http://127.0.0.1:8976/oauth/callback?state=private-state-value&code=private-authorization-code';

let previousIsTTY: boolean | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(runLoopbackFlow).mockReset();
  process.stdin.isTTY = previousIsTTY as boolean;
});

async function prepareLocalInstance(prefix: string): Promise<void> {
  const dataDir = mkdtempSync(path.join(tmpdir(), prefix));
  vi.stubEnv('FLUXMAIL_DATA_DIR', dataDir);
  vi.stubEnv('FLUXMAIL_ENCRYPTION_KEY', '5c'.repeat(32));
  const context = createContext();
  const setup = await setupInitialAdmin(context.db, {
    name: 'Local Owner',
    email: 'owner@example.com',
    password: 'River42!',
  });
  (context.db as unknown as { $client: { close(): void } }).$client.close();
  saveLocalInstance('local');
  saveSessionToken('local', setup.session.token);
}

function telemetrySpy() {
  const capture = vi.fn();
  return { capture, telemetry: { capture, shutdown: vi.fn().mockResolvedValue(undefined) } };
}

async function addGmail(telemetry: ReturnType<typeof telemetrySpy>['telemetry']): Promise<void> {
  await createCliProgram({ telemetry }).parseAsync([
    'node',
    'fluxmail',
    '--no-update-notifier',
    'accounts',
    'add',
    'gmail',
  ]);
}

describe('CLI loopback connection', () => {
  it('offers pasting at a terminal and records a pasted callback without its contents', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    previousIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    await prepareLocalInstance('fluxmail-cli-pasted-gmail-');
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => output.push(line));
    const { capture, telemetry } = telemetrySpy();
    vi.mocked(runLoopbackFlow).mockImplementation(async (config, onAuthUrl, onAuthorized, options) => {
      expect(options?.paste?.input).toBe(process.stdin);
      onAuthUrl('https://accounts.google.com/o/oauth2/v2/auth?state=private-state-value', {
        listening: true,
        pasteEnabled: true,
      });
      options?.onCallback?.('pasted');
      const result: AuthorizedOAuthResult = {
        email: 'private-mailbox@example.com',
        tokens: { refresh_token: 'private-refresh-token', access_token: 'private-access-token' },
        oauthClient: { ...config.google! },
      };
      return onAuthorized!(result);
    });

    try {
      await addGmail(telemetry);

      expect(process.exitCode).toBeUndefined();
      expect(output.join('\n')).toContain('Copy the full URL from its address bar and paste it here.');
      expect(capture).toHaveBeenCalledWith(
        'operation completed',
        expect.objectContaining({
          operation: 'accounts add',
          outcome: 'success',
          provider: 'gmail',
          connection_flow: 'loopback',
          oauth_callback: 'pasted',
        }),
      );
      const captured = JSON.stringify(capture.mock.calls);
      expect(captured).not.toContain(privateCallbackUrl);
      expect(captured).not.toContain('private-state-value');
      expect(captured).not.toContain('private-authorization-code');
      expect(captured).not.toContain('private-mailbox@example.com');
      expect(captured).not.toContain('private-refresh-token');
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('records a timeout and does not offer pasting without a terminal', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    previousIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;
    await prepareLocalInstance('fluxmail-cli-timeout-gmail-');
    const output: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => output.push(line));
    vi.spyOn(console, 'error').mockImplementation((line: string) => errors.push(line));
    const { capture, telemetry } = telemetrySpy();
    vi.mocked(runLoopbackFlow).mockImplementation(async (_config, onAuthUrl, _onAuthorized, options) => {
      expect(options?.paste).toBeUndefined();
      onAuthUrl('https://accounts.google.com/o/oauth2/v2/auth?state=private-state-value', {
        listening: true,
        pasteEnabled: false,
      });
      options?.onCallback?.('timeout');
      throw new EmailError('invalid_request', 'Timed out after 10 minutes waiting for Google to redirect back.');
    });

    try {
      await addGmail(telemetry);

      expect(process.exitCode).toBe(1);
      expect(output.join('\n')).toContain('Waiting for Google to redirect back...');
      expect(output.join('\n')).not.toContain('paste it here');
      expect(errors.join('\n')).toContain('Timed out after 10 minutes');
      expect(capture).toHaveBeenCalledWith(
        'operation completed',
        expect.objectContaining({
          operation: 'accounts add',
          outcome: 'error',
          error_code: 'invalid_request',
          connection_flow: 'loopback',
          oauth_callback: 'timeout',
        }),
      );
      const captured = JSON.stringify(capture.mock.calls);
      expect(captured).not.toContain('private-state-value');
      expect(captured).not.toContain('Timed out');
      expect(captured).not.toContain('owner@example.com');
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('points to the Docker container when the callback port is taken', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    previousIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    await prepareLocalInstance('fluxmail-cli-busy-port-gmail-');
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => output.push(line));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { telemetry } = telemetrySpy();
    vi.mocked(runLoopbackFlow).mockImplementation(async (_config, onAuthUrl) => {
      onAuthUrl('https://accounts.google.com/o/oauth2/v2/auth', { listening: false, pasteEnabled: true });
      throw new EmailError('invalid_request', 'Input closed before a callback URL was pasted.');
    });

    try {
      await addGmail(telemetry);

      const printed = output.join('\n');
      expect(printed).toContain('Port 8976 is already in use');
      expect(printed).toContain('docker compose exec fluxmail fluxmail accounts add gmail');
      expect(printed).toContain('paste it here');
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
