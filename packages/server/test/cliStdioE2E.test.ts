import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupInitialAdmin } from '../src/auth.js';
import { saveLocalInstance, saveRemoteInstance, saveSessionToken, useInstance } from '../src/cliInstances.js';
import { createContext } from '../src/context.js';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const runFile = promisify(execFile);

describe('CLI stdio process integration', { timeout: 15_000 }, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function environment(): NodeJS.ProcessEnv {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'fluxmail-stdio-e2e-'));
    vi.stubEnv('FLUXMAIL_DATA_DIR', dataDir);
    vi.stubEnv('FLUXMAIL_ENCRYPTION_KEY', 'bd'.repeat(32));
    vi.stubEnv('FLUXMAIL_TELEMETRY', '0');
    return { ...process.env, NO_UPDATE_NOTIFIER: '1' };
  }

  it.each(['local', 'personal'])(
    'completes an MCP handshake with local profile %s and a remote active',
    async (name) => {
      const env = environment();
      const context = createContext();
      try {
        const setup = await setupInitialAdmin(context.db, {
          name: 'Stdio Owner',
          email: 'stdio-owner@example.com',
          password: 'River42!',
        });
        saveLocalInstance(name);
        saveSessionToken(name, setup.session.token);
        saveRemoteInstance('work', 'https://private.example.com');
        saveSessionToken('work', 'fms_private_remote_session');
        useInstance('work');
      } finally {
        await context.registry.close();
        (context.db as unknown as { $client: { close(): void } }).$client.close();
      }

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', cliPath, 'stdio', '--profile', 'read-only'],
        env: Object.fromEntries(
          Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
        stderr: 'pipe',
      });
      let stderr = '';
      transport.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
      const client = new Client({ name: 'stdio-startup-test', version: '1.0.0' });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.some((tool) => tool.name === 'list_accounts')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'send_email')).toBe(false);
        const result = await client.callTool({ name: 'list_accounts', arguments: {} });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({ data: [] });
        expect(stderr).toContain('Fluxmail MCP server running on stdio');
        expect(stderr).not.toContain('fms_private_remote_session');
      } finally {
        await client.close();
        await transport.close();
      }
    },
  );

  it('prints one structured invalid-request error without protocol output or a new store', async () => {
    const env = environment();
    const error = await runFile(
      process.execPath,
      ['--import', 'tsx', cliPath, 'stdio', '--profile', 'private-invalid'],
      {
        env,
        timeout: 10_000,
      },
    ).then(
      () => {
        throw new Error('Expected stdio startup to fail');
      },
      (failure: Error & { code: number; stdout: string; stderr: string }) => failure,
    );

    expect(error.code).toBe(2);
    expect(error.stdout).toBe('');
    expect(JSON.parse(error.stderr.trim())).toMatchObject({
      error: { code: 'invalid_request', message: expect.stringContaining('Unknown profile') },
    });
    expect(existsSync(path.join(env.FLUXMAIL_DATA_DIR!, 'fluxmail.db'))).toBe(false);
  });
});
