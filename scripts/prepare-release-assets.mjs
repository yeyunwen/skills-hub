import assert from 'node:assert/strict';
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { resolve } from 'node:path';

const downloadedDirectory = resolve(process.argv[2] ?? 'downloaded-assets');
const releaseDirectory = resolve(process.argv[3] ?? 'release-assets');
const tag = process.argv[4];
const tagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!tag || !tagPattern.test(tag)) {
  console.error(
    'Usage: node scripts/prepare-release-assets.mjs <downloaded-directory> <release-directory> <vX.Y.Z>',
  );
  process.exit(1);
}

const version = tag.slice(1);
const artifactTargets = new Map([
  [
    'release-cli-aarch64-apple-darwin',
    `skh-${tag}-aarch64-apple-darwin.tar.gz`,
  ],
  [
    'release-cli-x86_64-apple-darwin',
    `skh-${tag}-x86_64-apple-darwin.tar.gz`,
  ],
  [
    'release-cli-x86_64-pc-windows-msvc',
    `skh-${tag}-x86_64-pc-windows-msvc.zip`,
  ],
  [
    'release-cli-x86_64-unknown-linux-gnu',
    `skh-${tag}-x86_64-unknown-linux-gnu.tar.gz`,
  ],
  [
    'release-desktop-darwin-aarch64-dmg',
    `skills-hub-v${version}-darwin-aarch64-unsigned.dmg`,
  ],
  [
    'release-desktop-darwin-x64-dmg',
    `skills-hub-v${version}-darwin-x64-unsigned.dmg`,
  ],
  [
    'release-desktop-linux-amd64-appimage',
    `skills-hub-v${version}-linux-amd64-unsigned.AppImage`,
  ],
  [
    'release-desktop-linux-amd64-deb',
    `skills-hub-v${version}-linux-amd64-unsigned.deb`,
  ],
  [
    'release-desktop-windows-x64-nsis',
    `skills-hub-v${version}-windows-x64-unsigned-setup.exe`,
  ],
  [
    'release-desktop-windows-x64-msi',
    `skills-hub-v${version}-windows-x64-unsigned.msi`,
  ],
]);

function artifactFile(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  assert.equal(entries.length, 1, `${directory} must contain exactly one file`);
  const entry = entries[0];
  assert.equal(entry.isFile(), true, `${directory}/${entry.name} must be a file`);
  const path = resolve(directory, entry.name);
  assert.equal(lstatSync(path).isSymbolicLink(), false, `${path} must not be a symlink`);
  return path;
}

const downloadedArtifacts = readdirSync(downloadedDirectory, {
  withFileTypes: true,
});
const downloadedNames = downloadedArtifacts.map((entry) => entry.name).sort();
const expectedNames = [...artifactTargets.keys()].sort();
assert.deepEqual(
  downloadedNames,
  expectedNames,
  'downloaded release artifacts must match the configured build matrix',
);
assert.equal(
  downloadedArtifacts.every((entry) => entry.isDirectory()),
  true,
  'downloaded release artifacts must remain in per-artifact directories',
);

mkdirSync(releaseDirectory, { recursive: true });
assert.deepEqual(
  readdirSync(releaseDirectory),
  [],
  `${releaseDirectory} must be empty before preparing assets`,
);

for (const [artifact, target] of artifactTargets) {
  const source = artifactFile(resolve(downloadedDirectory, artifact));
  copyFileSync(source, resolve(releaseDirectory, target), constants.COPYFILE_EXCL);
}

console.log(`Prepared ${artifactTargets.size} release assets for ${tag}`);
