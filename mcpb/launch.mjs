#!/usr/bin/env node

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.error('This Fluxmail bundle requires an Apple Silicon Mac.');
  process.exitCode = 1;
} else {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 22 || minor < 22) {
    console.error('This Fluxmail bundle requires Node.js 22.22 or later in the Node.js 22 release line.');
    process.exitCode = 1;
  } else {
    const { runCli } = await import('./dist/cli.js');
    await runCli();
  }
}
