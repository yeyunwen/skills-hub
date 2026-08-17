import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { releaseAssetNames, TAG_PATTERN } from './release-assets.mjs';

const directory = resolve(process.argv[2] ?? 'release-assets');
const tag = process.argv[3];
const withUpdaterJson = process.argv.includes('--with-updater-json');
const withChecksums = process.argv.includes('--with-checksums');

if (!tag || !TAG_PATTERN.test(tag)) {
  console.error('Usage: node scripts/check-release-assets.mjs <directory> <vX.Y.Z> [--with-updater-json] [--with-checksums]');
  process.exit(1);
}

const expected = releaseAssetNames(tag, { withUpdaterJson, withChecksums }).sort();
const actual = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
const missing = expected.filter((name) => !actual.includes(name));
const unexpected = actual.filter((name) => !expected.includes(name));
const empty = actual.filter((name) => statSync(resolve(directory, name)).size === 0);

if (missing.length || unexpected.length || empty.length) {
  if (missing.length) console.error(`Missing assets:\n- ${missing.join('\n- ')}`);
  if (unexpected.length) console.error(`Unexpected assets:\n- ${unexpected.join('\n- ')}`);
  if (empty.length) console.error(`Empty assets:\n- ${empty.join('\n- ')}`);
  process.exit(1);
}

console.log(`Release asset inventory passed: ${actual.length} files for ${tag}`);
