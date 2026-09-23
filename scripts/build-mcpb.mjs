#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repositoryRoot, '.context', 'mcpb');
const templateDirectory = path.join(repositoryRoot, 'mcpb');

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('The MCPB build currently supports Apple Silicon Macs only.');
  }
  if (process.versions.modules !== '127') {
    throw new Error('Build the MCPB with Node.js 22 so its SQLite native module matches the runtime.');
  }

  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/server/package.json')));
  const template = JSON.parse(await readFile(path.join(templateDirectory, 'manifest.template.json')));
  const manifest = { ...template, version: packageJson.version };
  const output = path.join(outputDirectory, `fluxmail-${packageJson.version}-darwin-arm64.mcpb`);

  await mkdir(outputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(outputDirectory, 'build-'));
  const bundleDirectory = path.join(temporaryDirectory, 'bundle');
  try {
    await run('pnpm', ['build']);
    try {
      await run('pnpm', ['--filter', 'fluxmail', 'deploy', '--prod', '--legacy', '--frozen-lockfile', bundleDirectory]);
    } finally {
      // pnpm's legacy deploy can switch the checkout's install to production dependencies.
      await run('pnpm', ['install', '--prod=false', '--frozen-lockfile']);
    }
    await copyFile(path.join(templateDirectory, 'icon.png'), path.join(bundleDirectory, 'icon.png'));
    await writeFile(path.join(bundleDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await run(path.join(repositoryRoot, 'node_modules', '.bin', 'mcpb'), ['pack', bundleDirectory, output]);

    const extractedDirectory = path.join(temporaryDirectory, 'extracted');
    await mkdir(extractedDirectory);
    await run('unzip', ['-qq', output, '-d', extractedDirectory]);
    await run(process.execPath, ['scripts/verify-mcpb.mjs', extractedDirectory, packageJson.version]);

    const archive = await stat(output);
    console.log(`Verified ${output} (${(archive.size / 1024 / 1024).toFixed(1)} MiB).`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code ?? 'unknown'}.`));
    });
  });
}

main().catch((error) => {
  console.error(`MCPB build failed: ${error.message}`);
  process.exitCode = 1;
});
