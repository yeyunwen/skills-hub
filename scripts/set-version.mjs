import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const requestedVersion = process.argv[2]?.replace(/^v/, '');
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const updates = new Map();

if (!requestedVersion || !versionPattern.test(requestedVersion)) {
  console.error('Usage: pnpm version:set <X.Y.Z or X.Y.Z-prerelease>');
  process.exit(1);
}

function updateJson(relativePath) {
  const value = JSON.parse(read(relativePath));
  value.version = requestedVersion;
  updates.set(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function read(relativePath) {
  return updates.get(relativePath) ?? readFileSync(resolve(root, relativePath), 'utf8');
}

function replaceOnce(relativePath, pattern, replacement, description) {
  const original = read(relativePath);
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...original.matchAll(new RegExp(pattern.source, flags))];

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${description} in ${relativePath}, found ${matches.length}`,
    );
  }

  updates.set(relativePath, original.replace(pattern, replacement));
}

function updateCargoLockPackage(packageName) {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  replaceOnce(
    'Cargo.lock',
    new RegExp(
      `(\\[\\[package\\]\\]\\nname = "${escapedName}"\\nversion = ")[^"]+("\\n)`,
    ),
    `$1${requestedVersion}$2`,
    `${packageName} lockfile version`,
  );
}

replaceOnce(
  'Cargo.toml',
  /(\[workspace\.package\][\s\S]*?^version\s*=\s*")[^"]+("$)/m,
  `$1${requestedVersion}$2`,
  'workspace package version',
);
replaceOnce(
  'crates/cli/Cargo.toml',
  /(^skills-hub-core\s*=\s*\{\s*version\s*=\s*")[^"]+("[^\n]*$)/m,
  `$1${requestedVersion}$2`,
  'skills-hub-core dependency version',
);

updateJson('package.json');
updateJson('apps/desktop/package.json');
updateJson('apps/desktop/src-tauri/tauri.conf.json');
updates.set('version.txt', `${requestedVersion}\n`);
updateCargoLockPackage('skh-cli');
updateCargoLockPackage('skills-hub-core');
updateCargoLockPackage('skills-hub-desktop');

for (const [relativePath, contents] of updates) {
  writeFileSync(resolve(root, relativePath), contents);
}

const check = spawnSync(
  process.execPath,
  [resolve(root, 'scripts/check-version.mjs'), requestedVersion],
  { cwd: root, stdio: 'inherit' },
);

if (check.status !== 0) {
  process.exit(check.status ?? 1);
}

console.log(`Updated project version to ${requestedVersion}`);
