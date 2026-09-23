'use strict';
// oxlint-disable typescript/no-require-imports

const path = require('node:path');

const supportedTargets = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'linuxmusl-arm64',
  'linuxmusl-x64',
  'win32-arm64',
  'win32-x64',
]);

function target() {
  const platform =
    process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime
      ? 'linuxmusl'
      : process.platform;
  const value = `${platform}-${process.arch}`;
  if (!supportedTargets.has(value)) {
    throw new Error(`This Fluxmail bundle does not support ${value}.`);
  }
  return value;
}

function load() {
  return require(path.join(__dirname, 'binding', `node-v127-${target()}`, 'better_sqlite3.node'));
}

module.exports = { target, load };
