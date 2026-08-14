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

const versions = new Map([
  ['Cargo workspace', workspaceVersion()],
  ['root package.json', readJson('package.json').version],
  ['desktop package.json', readJson('apps/desktop/package.json').version],
  ['Tauri config', readJson('apps/desktop/src-tauri/tauri.conf.json').version],
]);

const expected = process.argv[2]?.replace(/^v/, '') ?? versions.values().next().value;
const invalid = [...versions].filter(([, version]) => version !== expected);

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expected)) {
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
