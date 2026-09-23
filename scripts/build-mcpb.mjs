#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repositoryRoot, '.context', 'mcpb');
const templateDirectory = path.join(repositoryRoot, 'mcpb');
const sqliteVersion = '11.10.0';
const sqliteAssetHashes = {
  'darwin-arm64': '63241aadcd63e71febe5aff617f2dbac7ad461896241f479b11ec746d805bb7a',
  'darwin-x64': '0ae1a474d577ff3b68ed7988deaee814253e90b3052837657cbbd68194bf58a7',
  'linux-arm64': '7bdf1d50d7ba21f91a4d3c31da7b1acc1c10d7ef51dd887a6e07d851a75388da',
  'linux-x64': 'ea6a09d12d43cca31782ab0e09ecf442b8e2a49f5a02b219f5f117a6601ed306',
  'linuxmusl-arm64': '73cb074192819962f903d8d209d6fee86df7e85f84833467c011a8e076b74805',
  'linuxmusl-x64': 'ce9e2a28b09204e46959202b1fdfc58862fee681452efb3564575935b1532b03',
  'win32-arm64': '94f83534078493f68b710aa3081c314cadb1be37eee8309248cd3c232bf0aa61',
  'win32-x64': '94bdd2d44203759a4e1b76f4f7e91750cfeca4190e9fe356b05c1f73599124e9',
};
const argon2Platforms = new Set([
  'argon2-darwin-arm64',
  'argon2-darwin-x64',
  'argon2-linux-arm64-gnu',
  'argon2-linux-arm64-musl',
  'argon2-linux-x64-gnu',
  'argon2-linux-x64-musl',
  'argon2-win32-arm64-msvc',
  'argon2-win32-x64-msvc',
]);

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 22 || minor < 22 || process.versions.modules !== '127') {
    throw new Error('Build the MCPB with Node.js 22.22 or later in the Node.js 22 release line.');
  }

  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/server/package.json')));
  const template = JSON.parse(await readFile(path.join(templateDirectory, 'manifest.template.json')));
  const manifest = { ...template, version: packageJson.version };
  const output = path.join(outputDirectory, `fluxmail-${packageJson.version}.mcpb`);
  const smitheryOutput = path.join(outputDirectory, `fluxmail-${packageJson.version}-smithery.mcpb`);

  await mkdir(outputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(outputDirectory, 'build-'));
  const bundleDirectory = path.join(temporaryDirectory, 'bundle');
  const temporaryArchive = path.join(temporaryDirectory, path.basename(output));
  const temporarySmitheryArchive = path.join(temporaryDirectory, path.basename(smitheryOutput));
  try {
    await run('pnpm', ['build']);
    try {
      await run('pnpm', [
        '--filter',
        'fluxmail',
        'deploy',
        '--prod',
        '--legacy',
        '--frozen-lockfile',
        '--force',
        '--config.node-linker=hoisted',
        bundleDirectory,
      ]);
    } finally {
      // pnpm's legacy deploy can switch the checkout's install to production dependencies.
      await run('pnpm', ['install', '--prod=false', '--frozen-lockfile']);
    }
    await pruneUnusedGoogleApis(bundleDirectory);
    await addNativeVariants(bundleDirectory, temporaryDirectory);
    await copyFile(path.join(templateDirectory, 'icon.png'), path.join(bundleDirectory, 'icon.png'));
    await copyFile(path.join(templateDirectory, 'launch.mjs'), path.join(bundleDirectory, 'launch.mjs'));
    await writeFile(path.join(bundleDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await run(path.join(repositoryRoot, 'node_modules', '.bin', 'mcpb'), ['pack', bundleDirectory, temporaryArchive]);

    const extractedDirectory = path.join(temporaryDirectory, 'extracted');
    const toolsOutput = path.join(temporaryDirectory, 'tools.json');
    await mkdir(extractedDirectory);
    await run('unzip', ['-qq', temporaryArchive, '-d', extractedDirectory]);
    await run(process.execPath, ['scripts/verify-mcpb.mjs', extractedDirectory, packageJson.version, toolsOutput]);

    const tools = JSON.parse(await readFile(toolsOutput));
    const schemas = new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
    const smitheryManifest = {
      ...manifest,
      tools: manifest.tools.map((tool) => ({ ...tool, inputSchema: schemas.get(tool.name) })),
    };
    if (smitheryManifest.tools.some((tool) => !tool.inputSchema)) {
      throw new Error('The MCP tool list is missing an input schema required by Smithery.');
    }
    await writeFile(path.join(extractedDirectory, 'manifest.json'), `${JSON.stringify(smitheryManifest, null, 2)}\n`);
    await run('zip', ['-q', '-r', temporarySmitheryArchive, '.'], extractedDirectory);
    await run(process.execPath, ['scripts/verify-mcpb.mjs', extractedDirectory, packageJson.version]);

    await rename(temporaryArchive, output);
    await rename(temporarySmitheryArchive, smitheryOutput);
    const archive = await stat(output);
    console.log(`Verified ${output} (${(archive.size / 1024 / 1024).toFixed(1)} MiB).`);
    const smitheryArchive = await stat(smitheryOutput);
    console.log(`Verified ${smitheryOutput} (${(smitheryArchive.size / 1024 / 1024).toFixed(1)} MiB).`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function addNativeVariants(bundleDirectory, temporaryDirectory) {
  const sqliteDirectory = path.join(bundleDirectory, 'node_modules', 'better-sqlite3');
  const installedSqliteVersion = JSON.parse(await readFile(path.join(sqliteDirectory, 'package.json'))).version;
  if (installedSqliteVersion !== sqliteVersion) {
    throw new Error(`SQLite ${installedSqliteVersion} needs a new set of checked binaries.`);
  }
  const databaseFile = path.join(sqliteDirectory, 'lib', 'database.js');
  const databaseSource = await readFile(databaseFile, 'utf8');
  const defaultBinding = "require('bindings')('better_sqlite3.node')";
  if (databaseSource.split(defaultBinding).length !== 2) {
    throw new Error('The SQLite native loader changed; review the MCPB patch.');
  }
  await writeFile(databaseFile, databaseSource.replace(defaultBinding, "require('./mcpb-native.cjs').load()"));
  await copyFile(
    path.join(templateDirectory, 'sqlite-native.cjs'),
    path.join(sqliteDirectory, 'lib', 'mcpb-native.cjs'),
  );
  await rm(path.join(sqliteDirectory, 'build'), { recursive: true, force: true });
  await rm(path.join(sqliteDirectory, 'deps'), { recursive: true, force: true });
  await rm(path.join(sqliteDirectory, 'src'), { recursive: true, force: true });
  await rm(path.join(sqliteDirectory, 'binding.gyp'), { force: true });

  await Promise.all(
    Object.entries(sqliteAssetHashes).map(async ([platform, expectedHash]) => {
      const filename = `better-sqlite3-v${sqliteVersion}-node-v127-${platform}.tar.gz`;
      const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${sqliteVersion}/${filename}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`SQLite binary download failed for ${platform}: HTTP ${response.status}`);
      const archive = Buffer.from(await response.arrayBuffer());
      const actualHash = createHash('sha256').update(archive).digest('hex');
      if (actualHash !== expectedHash) throw new Error(`SQLite binary checksum mismatch for ${platform}.`);
      const archivePath = path.join(temporaryDirectory, filename);
      const bindingDirectory = path.join(sqliteDirectory, 'lib', 'binding', `node-v127-${platform}`);
      await writeFile(archivePath, archive);
      await mkdir(bindingDirectory, { recursive: true });
      await run('tar', [
        '-xzf',
        archivePath,
        '-C',
        bindingDirectory,
        '--strip-components=2',
        'build/Release/better_sqlite3.node',
      ]);
    }),
  );

  const argon2Directory = path.join(bundleDirectory, 'node_modules', '@node-rs');
  const entries = await readdir(argon2Directory, { withFileTypes: true });
  const installed = new Set(entries.map((entry) => entry.name));
  for (const platform of argon2Platforms) {
    if (!installed.has(platform)) throw new Error(`The Argon2 binary for ${platform} is missing.`);
  }
  await Promise.all(
    entries
      .filter((entry) => entry.name.startsWith('argon2-') && !argon2Platforms.has(entry.name))
      .map((entry) => rm(path.join(argon2Directory, entry.name), { recursive: true, force: true })),
  );
}

async function pruneUnusedGoogleApis(bundleDirectory) {
  const apisDirectory = path.join(bundleDirectory, 'node_modules', 'googleapis', 'build', 'src', 'apis');
  const entries = await readdir(apisDirectory, { withFileTypes: true });
  if (!entries.some((entry) => entry.isDirectory() && entry.name === 'gmail')) {
    throw new Error('The deployed Google APIs package has no Gmail client.');
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'gmail')
      .map((entry) => rm(path.join(apisDirectory, entry.name), { recursive: true, force: true })),
  );
}

function run(command, args, cwd = repositoryRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
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
