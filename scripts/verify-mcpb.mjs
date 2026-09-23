#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [bundleDirectory, expectedVersion, toolsOutput] = process.argv.slice(2);
if (!bundleDirectory || !expectedVersion) throw new Error('Provide the extracted bundle and expected version.');
const extractedDirectory = path.resolve(bundleDirectory);

const manifest = JSON.parse(await readFile(path.join(extractedDirectory, 'manifest.json')));
assert.equal(manifest.version, expectedVersion);
assert.deepEqual(manifest.compatibility.platforms, ['darwin', 'win32', 'linux']);
assert.equal(manifest.server.mcp_config.args[0], '${__dirname}/' + manifest.server.entry_point);
assert.deepEqual(manifest.server.mcp_config.args.slice(1), ['stdio']);

const nativePackages = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'linux-arm64': 'linux-arm64-gnu',
  'linux-x64': 'linux-x64-gnu',
  'linuxmusl-arm64': 'linux-arm64-musl',
  'linuxmusl-x64': 'linux-x64-musl',
  'win32-arm64': 'win32-arm64-msvc',
  'win32-x64': 'win32-x64-msvc',
};
for (const [target, argon2Target] of Object.entries(nativePackages)) {
  const sqliteBinary = path.join(
    extractedDirectory,
    'node_modules',
    'better-sqlite3',
    'lib',
    'binding',
    `node-v127-${target}`,
    'better_sqlite3.node',
  );
  assert.ok((await stat(sqliteBinary)).size > 0, `Missing SQLite binary for ${target}`);
  await stat(path.join(extractedDirectory, 'node_modules', '@node-rs', `argon2-${argon2Target}`, 'package.json'));
}

const entryPoint = path.join(extractedDirectory, manifest.server.entry_point);
const cli = path.join(extractedDirectory, 'dist/cli.js');
const version = spawnSync(process.execPath, [entryPoint, '--version'], {
  encoding: 'utf8',
  env: { ...process.env, FLUXMAIL_TELEMETRY: '0' },
});
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), expectedVersion);

const require = createRequire(path.join(extractedDirectory, 'package.json'));
const Database = require('better-sqlite3');
const sqlite = new Database(':memory:');
try {
  assert.equal(sqlite.prepare('select 1 as result').get().result, 1);
} finally {
  sqlite.close();
}
assert.equal(typeof require('@node-rs/argon2').hash, 'function');

const dataDirectory = await mkdtemp(path.join(tmpdir(), 'fluxmail-mcpb-check-'));
try {
  const setup = spawnSync(process.execPath, ['scripts/setup-mcpb-check.mjs', cli, dataDirectory], {
    encoding: 'utf8',
    env: { ...process.env, FLUXMAIL_TELEMETRY: '0' },
  });
  assert.equal(setup.status, 0, setup.stderr);
  process.stdout.write(setup.stdout);
  const tools = await checkTools(entryPoint, dataDirectory, manifest.tools.length);
  if (toolsOutput) await writeFile(toolsOutput, `${JSON.stringify(tools, null, 2)}\n`);
} finally {
  await rm(dataDirectory, { recursive: true, force: true });
}

console.log('Extracted MCPB passed CLI, native dependency, and MCP tool checks.');

function checkTools(entryPoint, dataDirectory, expectedTools) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPoint, 'stdio'], {
      env: { ...process.env, FLUXMAIL_DATA_DIR: dataDirectory, FLUXMAIL_TELEMETRY: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    let stderr = '';
    let completed = false;
    let failure;
    let toolList;
    const timeout = setTimeout(() => finish(new Error(`MCP handshake timed out: ${stderr}`)), 10_000);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish(new Error(`MCP wrote invalid JSON: ${line}`));
          return;
        }
        if (message.id === 1) {
          if (message.error) return finish(new Error(`MCP initialization failed: ${JSON.stringify(message.error)}`));
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        }
        if (message.id === 2) {
          if (message.error) return finish(new Error(`MCP tools/list failed: ${JSON.stringify(message.error)}`));
          try {
            assert.equal(message.result.tools.length, expectedTools);
            assert.deepEqual(
              new Set(message.result.tools.map((tool) => tool.name)),
              new Set(manifest.tools.map((tool) => tool.name)),
            );
            finish(undefined, message.result.tools);
          } catch (error) {
            finish(error);
          }
        }
      }
    });
    child.on('error', finish);
    child.on('close', (code) => {
      if (!completed) finish(new Error(`MCP process exited with status ${code}: ${stderr}`));
      if (failure) reject(failure);
      else resolve(toolList);
    });
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcpb-check', version: '1' } },
    });

    function send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    function finish(error, tools) {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      failure = error;
      toolList = tools;
      child.kill();
    }
  });
}
