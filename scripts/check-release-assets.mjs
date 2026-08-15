import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'release-assets');
const tag = process.argv[3];
const includeChecksums = process.argv.includes('--with-checksums');
const tagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!tag || !tagPattern.test(tag)) {
  console.error(
    'Usage: node scripts/check-release-assets.mjs <directory> <vX.Y.Z> [--with-checksums]',
  );
  process.exit(1);
}

const version = tag.slice(1);
// Keep this exact inventory aligned with release.yml's CLI targets and
// prepare-release-assets.mjs. Extra files fail intentionally.
const expected = [
  `skh-${tag}-aarch64-apple-darwin.tar.gz`,
  `skh-${tag}-x86_64-apple-darwin.tar.gz`,
  `skh-${tag}-x86_64-pc-windows-msvc.zip`,
  `skh-${tag}-x86_64-unknown-linux-gnu.tar.gz`,
  `skills-hub-v${version}-darwin-aarch64-unsigned.dmg`,
  `skills-hub-v${version}-darwin-x64-unsigned.dmg`,
  `skills-hub-v${version}-linux-amd64-unsigned.AppImage`,
  `skills-hub-v${version}-linux-amd64-unsigned.deb`,
  `skills-hub-v${version}-windows-x64-unsigned-setup.exe`,
  `skills-hub-v${version}-windows-x64-unsigned.msi`,
];

if (includeChecksums) {
  expected.push('SHA256SUMS');
}

const actual = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
expected.sort();

const missing = expected.filter((name) => !actual.includes(name));
const unexpected = actual.filter((name) => !expected.includes(name));
const empty = actual.filter(
  (name) => statSync(resolve(directory, name)).size === 0,
);

if (missing.length || unexpected.length || empty.length) {
  if (missing.length) console.error(`Missing assets:\n- ${missing.join('\n- ')}`);
  if (unexpected.length) console.error(`Unexpected assets:\n- ${unexpected.join('\n- ')}`);
  if (empty.length) console.error(`Empty assets:\n- ${empty.join('\n- ')}`);
  process.exit(1);
}

console.log(`Release asset inventory passed: ${actual.length} files for ${tag}`);
