import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { findPackageLicenseProblems } from './check-package-licenses.mjs';

const temporaryDirectories: string[] = [];

async function createFixture() {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'fluxmail-license-'));
  temporaryDirectories.push(rootDirectory);

  const packageDirectory = path.join(rootDirectory, 'packages', 'example');
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(path.join(rootDirectory, 'LICENSE.md'), 'Elastic License 2.0\n');
  await writeFile(path.join(rootDirectory, 'package.json'), JSON.stringify({ license: 'Elastic-2.0' }));
  await writeFile(path.join(packageDirectory, 'LICENSE.md'), 'Elastic License 2.0\n');
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({ license: 'Elastic-2.0' }));

  return { packageDirectory, rootDirectory };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('findPackageLicenseProblems', () => {
  it('accepts packages with the canonical license text and metadata', async () => {
    const fixture = await createFixture();

    await expect(
      findPackageLicenseProblems({
        rootDirectory: fixture.rootDirectory,
        packageDirectories: [fixture.packageDirectory],
      }),
    ).resolves.toEqual([]);
  });

  it('reports a missing package license', async () => {
    const fixture = await createFixture();
    await rm(path.join(fixture.packageDirectory, 'LICENSE.md'));

    const problems = await findPackageLicenseProblems({
      rootDirectory: fixture.rootDirectory,
      packageDirectories: [fixture.packageDirectory],
    });

    expect(problems).toContain(`${fixture.packageDirectory} has no LICENSE.md.`);
  });

  it('reports a package license that differs from the root license', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.packageDirectory, 'LICENSE.md'), 'Old license\n');

    const problems = await findPackageLicenseProblems({
      rootDirectory: fixture.rootDirectory,
      packageDirectories: [fixture.packageDirectory],
    });

    expect(problems).toContain(
      `${fixture.packageDirectory} has an outdated LICENSE.md. Copy the root LICENSE.md into the package.`,
    );
  });

  it('reports incorrect root and package manifest metadata', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.rootDirectory, 'package.json'), JSON.stringify({ license: 'UNLICENSED' }));
    await writeFile(
      path.join(fixture.packageDirectory, 'package.json'),
      JSON.stringify({ license: 'SEE LICENSE IN LICENSE.md' }),
    );

    const problems = await findPackageLicenseProblems({
      rootDirectory: fixture.rootDirectory,
      packageDirectories: [fixture.packageDirectory],
    });

    expect(problems).toEqual([
      'The root package.json must declare "license": "Elastic-2.0".',
      `${fixture.packageDirectory}/package.json must declare "license": "Elastic-2.0".`,
    ]);
  });
});
