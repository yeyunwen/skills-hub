import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { releaseVersion, updaterPlatforms } from './release-assets.mjs';

const releaseDirectory = resolve(process.argv[2] ?? 'release-assets');
const tag = process.argv[3];
const notesFile = resolve(process.argv[4] ?? 'current-notes.md');
const repository = process.argv[5];
const publishedAt = process.argv[6];

if (!tag || !repository || !publishedAt || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  console.error('Usage: node scripts/generate-updater-json.mjs <release-directory> <vX.Y.Z> <notes-file> <owner/repo> <published-at>');
  process.exit(1);
}

const date = new Date(publishedAt);
assert.equal(Number.isFinite(date.getTime()), true, `invalid publish date: ${publishedAt}`);
const platforms = {};

for (const updater of updaterPlatforms(tag)) {
  const assetPath = resolve(releaseDirectory, updater.asset);
  const signaturePath = `${assetPath}.sig`;
  assert.ok(statSync(assetPath).size > 0, `${updater.asset} must not be empty`);
  assert.ok(statSync(signaturePath).size > 0, `${updater.asset}.sig must not be empty`);
  const value = {
    signature: readFileSync(signaturePath, 'utf8').trim(),
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(updater.asset)}`,
  };
  for (const key of updater.keys) platforms[key] = value;
}

const content = {
  version: releaseVersion(tag),
  notes: readFileSync(notesFile, 'utf8').trim(),
  pub_date: date.toISOString(),
  platforms,
};

writeFileSync(resolve(releaseDirectory, 'latest.json'), `${JSON.stringify(content, null, 2)}\n`, { flag: 'wx' });
console.log(`Generated latest.json for ${tag} with ${Object.keys(platforms).length} platform entries`);
