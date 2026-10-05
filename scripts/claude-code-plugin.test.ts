import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { checkClaudePlugin, publishClaudePlugin, syncClaudePlugin } from './claude-code-plugin.mjs';
import { repositoryRoot } from './release-config.mjs';

const execute = promisify(execFile);
const temporaryDirectories: string[] = [];
const git = async (root: string, ...args: string[]) => (await execute('git', args, { cwd: root })).stdout.trim();

async function fixture(version = '0.11.2') {
  const temporary = await mkdtemp(path.join(tmpdir(), 'fluxmail-plugin-test-'));
  temporaryDirectories.push(temporary);
  const root = path.join(temporary, 'checkout');
  await mkdir(path.join(root, 'packages/server'), { recursive: true });
  await mkdir(path.join(root, 'integrations'), { recursive: true });
  await cp(path.join(repositoryRoot, 'integrations/claude-code'), path.join(root, 'integrations/claude-code'), {
    recursive: true,
  });
  await writeFile(
    path.join(root, 'packages/server/package.json'),
    JSON.stringify({
      name: 'fluxmail',
      version,
      repository: { url: 'git+https://github.com/churichard/fluxmail.git', directory: 'packages/server' },
    }),
  );
  await syncClaudePlugin(root);
  return { root, temporary };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Claude Code plugin release automation', () => {
  it('updates both the manifest and launcher when the Fluxmail version changes', async () => {
    const { root } = await fixture();
    const packagePath = path.join(root, 'packages/server/package.json');
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
    await writeFile(packagePath, JSON.stringify({ ...manifest, version: '0.12.0' }));
    await expect(checkClaudePlugin(root)).rejects.toThrow('must use Fluxmail version 0.12.0');
    const manifestPath = path.join(root, 'integrations/claude-code/.claude-plugin/plugin.json');
    const manifestSource = await readFile(manifestPath, 'utf8');
    await syncClaudePlugin(root);
    await expect(checkClaudePlugin(root)).resolves.toBe('0.12.0');
    expect(await readFile(manifestPath, 'utf8')).toBe(manifestSource.replace('0.11.2', '0.12.0'));
    const config = JSON.parse(await readFile(path.join(root, 'integrations/claude-code/.mcp.json'), 'utf8'));
    expect(config.mcpServers.fluxmail.args).toEqual(['-y', 'fluxmail@0.12.0', 'stdio', '--profile', 'read-only']);
    expect(config.mcpServers.fluxmail.env.FLUXMAIL_TELEMETRY).toBe('0');
  });

  it.each(['fluxmail@latest', 'fluxmail@^0.11.2', 'fluxmail@0.11.1'])(
    'rejects an unreviewed or stale launcher package: %s',
    async (packageName) => {
      const { root } = await fixture();
      const configPath = path.join(root, 'integrations/claude-code/.mcp.json');
      const config = await readFile(configPath, 'utf8');
      await writeFile(configPath, config.replace('fluxmail@0.11.2', packageName));
      await expect(checkClaudePlugin(root)).rejects.toThrow('must run fluxmail@0.11.2');
    },
  );

  it('rejects missing local icons', async () => {
    const { root } = await fixture();
    const bundle = path.join(root, 'integrations/claude-code');
    await rm(path.join(bundle, 'icon.png'));
    await expect(checkClaudePlugin(root)).rejects.toThrow();
  });

  it('skips historical retries and rejects prerelease or unreleased manual refreshes before Git writes', async () => {
    const { root } = await fixture();
    await expect(
      publishClaudePlugin({ root, latestVersion: async () => '0.12.0', skipStale: true }),
    ).resolves.toMatchObject({ status: 'skipped' });
    await expect(publishClaudePlugin({ root, latestVersion: async () => '0.12.0' })).rejects.toThrow(
      'must match stable npm latest',
    );
    const prerelease = await fixture('0.12.0-beta.1');
    await syncClaudePlugin(prerelease.root);
    await expect(
      publishClaudePlugin({ root: prerelease.root, latestVersion: async () => '0.12.0-beta.1' }),
    ).rejects.toThrow('must match stable npm latest');
  });

  it('publishes an ordinary commit, removes stale bundle files, and makes retries idempotent without changing the checkout', async () => {
    const { root, temporary } = await fixture();
    const remote = path.join(temporary, 'remote.git');
    await execute('git', ['init', '--bare', remote]);
    await git(root, 'init', '-b', 'main');
    await git(root, 'config', 'user.name', 'Plugin test');
    await git(root, 'config', 'user.email', 'plugin-test@example.com');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'Source');
    const sourceSha = await git(root, 'rev-parse', 'HEAD');
    await git(root, 'remote', 'add', 'origin', remote);
    await git(root, 'checkout', '--orphan', 'claude-code-plugin');
    await git(root, 'rm', '-r', '-f', '.');
    await writeFile(path.join(root, 'obsolete.txt'), 'Old bundle');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'Previous bundle');
    const previousSha = await git(root, 'rev-parse', 'HEAD');
    await git(root, 'push', 'origin', 'claude-code-plugin');
    await git(root, 'checkout', 'main');

    const options = { root, latestVersion: async () => '0.11.2' };
    const result = await publishClaudePlugin(options);
    expect(result.status).toBe('published');
    expect(await git(root, 'show', `${result.sha}^:obsolete.txt`)).toBe('Old bundle');
    expect(await git(root, 'rev-parse', `${result.sha}^`)).toBe(previousSha);
    expect(await git(root, 'ls-tree', '--name-only', result.sha)).not.toContain('obsolete.txt');
    expect(JSON.parse(await git(root, 'show', `${result.sha}:.claude-plugin/plugin.json`)).version).toBe('0.11.2');
    expect(JSON.parse(await git(root, 'show', `${result.sha}:.mcp.json`)).mcpServers.fluxmail.args[1]).toBe(
      'fluxmail@0.11.2',
    );
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(sourceSha);
    expect(await git(root, 'status', '--porcelain')).toBe('');
    expect(await publishClaudePlugin(options)).toEqual({ status: 'unchanged', version: '0.11.2', sha: result.sha });
    expect((await git(root, 'worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1);
  });
});
