import assert from 'node:assert/strict';
import { constants, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { desktopAssetsForTarget } from './release-assets.mjs';

const sourceDirectory = resolve(process.argv[2] ?? 'target/release/bundle');
const outputDirectory = resolve(process.argv[3] ?? 'dist/desktop-release');
const tag = process.argv[4];
const target = process.argv[5];

if (!tag || !target) {
  console.error('Usage: node scripts/stage-desktop-release.mjs <bundle-directory> <output-directory> <vX.Y.Z> <target>');
  process.exit(1);
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    // AppImage AppDir trees contain internal links such as `.DirIcon`. They
    // are implementation details of the bundle, not release assets.
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return listFiles(path);
    assert.equal(entry.isFile(), true, `${path} must be a file`);
    return [path];
  });
}

const selectors = {
  'aarch64-apple-darwin': [
    (path) => path.includes('/dmg/') && path.endsWith('.dmg'),
    (path) => path.includes('/macos/') && path.endsWith('.app.tar.gz'),
    (path) => path.includes('/macos/') && path.endsWith('.app.tar.gz.sig'),
  ],
  'x86_64-apple-darwin': [
    (path) => path.includes('/dmg/') && path.endsWith('.dmg'),
    (path) => path.includes('/macos/') && path.endsWith('.app.tar.gz'),
    (path) => path.includes('/macos/') && path.endsWith('.app.tar.gz.sig'),
  ],
  'x86_64-unknown-linux-gnu': [
    (path) => path.includes('/appimage/') && path.endsWith('.AppImage'),
    (path) => path.includes('/appimage/') && path.endsWith('.AppImage.sig'),
    (path) => path.includes('/deb/') && path.endsWith('.deb'),
    (path) => path.includes('/deb/') && path.endsWith('.deb.sig'),
  ],
  'x86_64-pc-windows-msvc': [
    (path) => path.includes('/nsis/') && path.endsWith('-setup.exe'),
    (path) => path.includes('/nsis/') && path.endsWith('-setup.exe.sig'),
    (path) => path.includes('/msi/') && path.endsWith('.msi'),
    (path) => path.includes('/msi/') && path.endsWith('.msi.sig'),
  ],
};

const targetSelectors = selectors[target];
if (!targetSelectors) throw new Error(`unsupported desktop release target: ${target}`);

const files = listFiles(sourceDirectory);
const outputNames = desktopAssetsForTarget(tag, target);
mkdirSync(outputDirectory, { recursive: true });
assert.deepEqual(readdirSync(outputDirectory), [], `${outputDirectory} must be empty before staging assets`);

for (const [index, selector] of targetSelectors.entries()) {
  const matches = files.filter((path) => selector(path.replaceAll('\\', '/')));
  assert.equal(matches.length, 1, `${target} release bundle selector ${index + 1} must match exactly one file`);
  copyFileSync(matches[0], resolve(outputDirectory, outputNames[index]), constants.COPYFILE_EXCL);
}

console.log(`Staged ${outputNames.length} desktop release assets for ${target}`);
