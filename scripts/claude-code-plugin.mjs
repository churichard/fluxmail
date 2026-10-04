#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { loadReleaseVersion, repositoryRoot } from './release-config.mjs';

const execute = promisify(execFile);
const bundleDirectory = 'integrations/claude-code';
const sourceBranch = 'claude-code-plugin';

export async function syncClaudePlugin(root = repositoryRoot) {
  const { version } = await loadReleaseVersion(root);
  const manifestPath = path.join(root, bundleDirectory, '.claude-plugin/plugin.json');
  const manifestSource = await readFile(manifestPath, 'utf8');
  JSON.parse(manifestSource);
  await writeFile(manifestPath, manifestSource.replace(/("version"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(version)}`));
  const configPath = path.join(root, bundleDirectory, '.mcp.json');
  const configSource = await readFile(configPath, 'utf8');
  const config = JSON.parse(configSource);
  await writeFile(
    configPath,
    configSource.replace(JSON.stringify(config.mcpServers.fluxmail.args[1]), JSON.stringify(`fluxmail@${version}`)),
  );
}

export async function checkClaudePlugin(root = repositoryRoot) {
  const { version } = await loadReleaseVersion(root);
  const bundle = path.join(root, bundleDirectory);
  const manifest = JSON.parse(await readFile(path.join(bundle, '.claude-plugin/plugin.json'), 'utf8'));
  if (manifest.version !== version) throw new Error(`Claude Code plugin must use Fluxmail version ${version}.`);
  if (manifest.icon !== './icon.png') throw new Error('Claude Code plugin icon must be ./icon.png.');
  const icon = await readFile(path.join(bundle, 'icon.png'));
  if (!icon.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('Claude Code plugin icon must be a PNG.');
  }
  const config = JSON.parse(await readFile(path.join(bundle, '.mcp.json'), 'utf8'));
  const server = config.mcpServers?.fluxmail;
  if (
    server?.command !== 'npx' ||
    JSON.stringify(server.args) !== JSON.stringify(['-y', `fluxmail@${version}`, 'stdio', '--profile', 'read-only']) ||
    server.env?.FLUXMAIL_TELEMETRY !== '0'
  ) {
    throw new Error(
      `Claude Code plugin must run fluxmail@${version} with read-only permissions and telemetry disabled.`,
    );
  }
  return version;
}

async function npmLatestVersion() {
  const response = await fetch('https://registry.npmjs.org/fluxmail/latest', {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Cannot read stable Fluxmail version from npm: HTTP ${response.status}.`);
  const { version } = await response.json();
  if (typeof version !== 'string') throw new Error('npm latest metadata must include a Fluxmail version.');
  return version;
}

export async function publishClaudePlugin({
  root = repositoryRoot,
  latestVersion = npmLatestVersion,
  skipStale = false,
} = {}) {
  const version = await checkClaudePlugin(root);
  const latest = await latestVersion();
  if (version.includes('-') || version !== latest) {
    if (skipStale) return { status: 'skipped', version, latest };
    throw new Error(`Plugin source version ${version} must match stable npm latest ${latest}.`);
  }

  const git = async (args, cwd = root) => (await execute('git', args, { cwd })).stdout.trim();
  const sourceSha = await git(['rev-parse', 'HEAD']);
  const temporary = await mkdtemp(path.join(tmpdir(), 'fluxmail-claude-plugin-'));
  const worktree = path.join(temporary, 'source');
  let added = false;
  try {
    await git(['fetch', 'origin', `${sourceBranch}:refs/remotes/origin/${sourceBranch}`]);
    await git(['worktree', 'add', '--detach', worktree, `refs/remotes/origin/${sourceBranch}`]);
    added = true;
    await git(['rm', '-r', '--ignore-unmatch', '--', '.'], worktree);
    await cp(path.join(root, bundleDirectory), worktree, { recursive: true });
    await git(['add', '--all'], worktree);
    const changes = await git(['diff', '--cached', '--name-only'], worktree);
    if (!changes) return { status: 'unchanged', version, sha: await git(['rev-parse', 'HEAD'], worktree) };
    await git(
      [
        '-c',
        'user.name=Fluxmail release',
        '-c',
        'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit',
        '-m',
        `Update Claude Code plugin for Fluxmail ${version}`,
        '-m',
        `Source: ${sourceSha}`,
      ],
      worktree,
    );
    await git(['push', 'origin', `HEAD:refs/heads/${sourceBranch}`], worktree);
    return { status: 'published', version, sha: await git(['rev-parse', 'HEAD'], worktree) };
  } finally {
    if (added) await git(['worktree', 'remove', '--force', worktree]);
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main(args) {
  const [command, ...options] = args;
  if (options.some((option) => command !== 'publish' || option !== '--skip-stale')) {
    throw new Error('Usage: claude-code-plugin.mjs check|sync|publish [--skip-stale]');
  }
  if (command === 'sync') await syncClaudePlugin();
  else if (command === 'check') console.log(`Claude Code plugin matches Fluxmail ${await checkClaudePlugin()}.`);
  else if (command === 'publish')
    console.log(JSON.stringify(await publishClaudePlugin({ skipStale: options.includes('--skip-stale') })));
  else throw new Error('Usage: claude-code-plugin.mjs check|sync|publish [--skip-stale]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
