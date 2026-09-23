#!/usr/bin/env node

import { createRequire } from 'node:module';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 22) {
  console.error('This Fluxmail bundle requires Node.js 22.22 or later in the Node.js 22 release line.');
  process.exitCode = 1;
} else {
  try {
    createRequire(import.meta.url)('./node_modules/better-sqlite3/lib/mcpb-native.cjs').target();
    const { runCli } = await import('./dist/cli.js');
    await runCli();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
