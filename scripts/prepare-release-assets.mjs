import assert from 'node:assert/strict';
import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { cliArtifactTargets, desktopArtifactTargets, TAG_PATTERN } from './release-assets.mjs';

const downloadedDirectory = resolve(process.argv[2] ?? 'downloaded-assets');
const releaseDirectory = resolve(process.argv[3] ?? 'release-assets');
const tag = process.argv[4];

if (!tag || !TAG_PATTERN.test(tag)) {
  console.error('Usage: node scripts/prepare-release-assets.mjs <downloaded-directory> <release-directory> <vX.Y.Z>');
  process.exit(1);
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    assert.equal(entry.isFile(), true, `${path} must be a file`);
    assert.equal(lstatSync(path).isSymbolicLink(), false, `${path} must not be a symlink`);
    return [path];
  });
}

const artifactTargets = new Map([
  ...[...cliArtifactTargets(tag)].map(([artifact, asset]) => [artifact, [asset]]),
  ...desktopArtifactTargets(tag),
]);
const downloadedArtifacts = readdirSync(downloadedDirectory, { withFileTypes: true });
assert.deepEqual(
  downloadedArtifacts.map((entry) => entry.name).sort(),
  [...artifactTargets.keys()].sort(),
  'downloaded release artifacts must match the configured build matrix',
);
assert.equal(
  downloadedArtifacts.every((entry) => entry.isDirectory()),
  true,
  'downloaded release artifacts must remain in per-artifact directories',
);

mkdirSync(releaseDirectory, { recursive: true });
assert.deepEqual(readdirSync(releaseDirectory), [], `${releaseDirectory} must be empty before preparing assets`);

for (const [artifact, assets] of artifactTargets) {
  const files = listFiles(resolve(downloadedDirectory, artifact));
  assert.deepEqual(
    files.map((path) => basename(path)).sort(),
    [...assets].sort(),
    `${artifact} must contain the exact staged release assets`,
  );
  for (const asset of assets) {
    const source = files.find((path) => basename(path) === asset);
    assert.ok(source, `${artifact}/${asset} must exist`);
    copyFileSync(source, resolve(releaseDirectory, asset), constants.COPYFILE_EXCL);
  }
}

console.log(`Prepared ${[...artifactTargets.values()].flat().length} release assets for ${tag}`);
