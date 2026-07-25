#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const EXPECTED_LICENSE = 'Elastic-2.0';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

export async function findPackageLicenseProblems({ rootDirectory = repositoryRoot, packageDirectories }) {
  const problems = [];
  const rootLicense = await readText(
    path.join(rootDirectory, 'LICENSE.md'),
    'The root LICENSE.md is missing.',
    problems,
  );

  await checkManifest(path.join(rootDirectory, 'package.json'), 'The root package.json', problems);

  for (const directory of packageDirectories) {
    const packageLicense = await readText(
      path.join(directory, 'LICENSE.md'),
      `${directory} has no LICENSE.md.`,
      problems,
    );

    if (rootLicense !== undefined && packageLicense !== undefined && packageLicense !== rootLicense) {
      problems.push(`${directory} has an outdated LICENSE.md. Copy the root LICENSE.md into the package.`);
    }

    await checkManifest(path.join(directory, 'package.json'), `${directory}/package.json`, problems);
  }

  return problems;
}

async function readText(filePath, missingMessage, problems) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    problems.push(missingMessage);
    return undefined;
  }
}

async function checkManifest(filePath, label, problems) {
  const source = await readText(filePath, `${label} is missing.`, problems);
  if (source === undefined) return;

  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    problems.push(`${label} is not valid JSON.`);
    return;
  }

  if (manifest.license !== EXPECTED_LICENSE) {
    problems.push(`${label} must declare "license": "${EXPECTED_LICENSE}".`);
  }
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const packageDirectories = process.argv.slice(2);
  if (packageDirectories.length === 0) {
    fail('No package directories were provided.');
  }

  const problems = await findPackageLicenseProblems({ packageDirectories });
  if (problems.length > 0) {
    fail(problems.join('\n'));
  }
}
