import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

function workspaceVersion() {
  const manifest = readFileSync(resolve(root, 'Cargo.toml'), 'utf8');
  const section = manifest.match(
    /\[workspace\.package\]([\s\S]*?)(?=\n\[|$)/,
  )?.[1];
  const version = section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

  if (!version) {
    throw new Error('Cargo.toml is missing workspace.package.version');
  }

  return version;
}

function cliCoreDependencyVersion() {
  const manifest = readFileSync(resolve(root, 'crates/cli/Cargo.toml'), 'utf8');
  const version = manifest.match(
    /^skills-hub-core\s*=\s*\{\s*version\s*=\s*"([^"]+)"/m,
  )?.[1];

  if (!version) {
    throw new Error(
      'crates/cli/Cargo.toml is missing the skills-hub-core version',
    );
  }

  return version;
}

function cargoLockVersion(packageName) {
  const lockfile = readFileSync(resolve(root, 'Cargo.lock'), 'utf8');
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const version = lockfile.match(
    new RegExp(
      `\\[\\[package\\]\\]\\nname = "${escapedName}"\\nversion = "([^"]+)"`,
    ),
  )?.[1];

  if (!version) {
    throw new Error(`Cargo.lock is missing ${packageName}`);
  }

  return version;
}

const versions = new Map([
  ['version.txt', readFileSync(resolve(root, 'version.txt'), 'utf8').trim()],
  ['Cargo workspace', workspaceVersion()],
  ['root package.json', readJson('package.json').version],
  ['desktop package.json', readJson('apps/desktop/package.json').version],
  ['Tauri config', readJson('apps/desktop/src-tauri/tauri.conf.json').version],
  ['CLI core dependency', cliCoreDependencyVersion()],
  ['Cargo.lock skh-cli', cargoLockVersion('skh-cli')],
  ['Cargo.lock skills-hub-core', cargoLockVersion('skills-hub-core')],
  ['Cargo.lock skills-hub-desktop', cargoLockVersion('skills-hub-desktop')],
]);

const expected = process.argv[2]?.replace(/^v/, '') ?? versions.values().next().value;
const invalid = [...versions].filter(([, version]) => version !== expected);

const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!versionPattern.test(expected)) {
  console.error(`Invalid release version: ${expected}`);
  process.exit(1);
}

if (invalid.length > 0) {
  console.error(`Expected every project version to be ${expected}:`);
  for (const [name, version] of versions) {
    console.error(`- ${name}: ${version}`);
  }
  process.exit(1);
}

console.log(`Version check passed: ${expected}`);
