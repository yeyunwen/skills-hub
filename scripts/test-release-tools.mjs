import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  cliArtifactTargets,
  desktopArtifactTargets,
  desktopAssetsForTarget,
  releaseAssetNames,
} from './release-assets.mjs';

const root = resolve(import.meta.dirname, '..');

for (const workflow of [
  '.github/workflows/release-please.yml',
  '.github/workflows/release.yml',
]) {
  const source = readFileSync(resolve(root, workflow), 'utf8');
  const jobsIndex = source.indexOf('\njobs:');
  assert.notEqual(jobsIndex, -1, `${workflow} must define jobs`);
  const workflowScope = source.slice(0, jobsIndex);
  assert.match(
    workflowScope,
    /^\s*GH_REPO:\s*\$\{\{ github\.repository \}\}\s*$/m,
    `${workflow} must give every gh command an explicit repository context`,
  );
}

const releaseWorkflow = readFileSync(
  resolve(root, '.github/workflows/release.yml'),
  'utf8',
);

function workflowJob(source, name) {
  const marker = `\n  ${name}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `release workflow must define the ${name} job`);
  const remaining = source.slice(start + marker.length);
  const nextJob = remaining.search(/\n  [a-zA-Z0-9_-]+:\n/);
  return nextJob === -1 ? remaining : remaining.slice(0, nextJob);
}

for (const job of ['validate', 'cli', 'desktop']) {
  assert.match(
    workflowJob(releaseWorkflow, job),
    /^          ref: \$\{\{ env\.RELEASE_TAG \}\}\s*$/m,
    `${job} must build and validate the immutable release tag`,
  );
}

for (const job of ['release', 'verify']) {
  assert.match(
    workflowJob(releaseWorkflow, job),
    /^          ref: \$\{\{ github\.sha \}\}\s*$/m,
    `${job} must use tooling from the dispatched workflow revision`,
  );
  assert.doesNotMatch(
    workflowJob(releaseWorkflow, job),
    /^          ref: \$\{\{ env\.RELEASE_TAG \}\}\s*$/m,
    `${job} must not load release tooling from an older tag`,
  );
}

for (const job of ['validate', 'verify']) {
  assert.match(
    workflowJob(releaseWorkflow, job),
    /^    permissions:\n(?:      .*\n)*?      contents: write\s*$/m,
    `${job} must have push-level visibility for the draft release`,
  );
}

assert.match(workflowJob(releaseWorkflow, 'desktop'), /TAURI_SIGNING_PRIVATE_KEY/);
assert.match(workflowJob(releaseWorkflow, 'desktop'), /--bundles app,dmg/);
assert.doesNotMatch(workflowJob(releaseWorkflow, 'desktop'), /--no-sign/);
assert.match(workflowJob(releaseWorkflow, 'release'), /generate-updater-json\.mjs/);

function runScript(script, args, { input = '', succeeds = true } = {}) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
  });

  assert.equal(
    result.status === 0,
    succeeds,
    [result.stdout, result.stderr].filter(Boolean).join('\n'),
  );
}

runScript('scripts/check-release-tag.mjs', ['v0.2.0-beta.1'], {
  input: 'v0.1.0\nv0.1.1\n',
});
runScript('scripts/check-release-tag.mjs', ['v0.2.0-beta.2'], {
  input: 'v0.2.0-beta.1\n',
});
runScript('scripts/check-release-tag.mjs', ['v0.2.0'], {
  input: 'v0.2.0-beta.2\n',
});
runScript('scripts/check-release-tag.mjs', ['v0.1.0'], {
  input: 'v0.1.1\n',
  succeeds: false,
});

const fixture = mkdtempSync(join(tmpdir(), 'skills-hub-release-assets-'));
const downloadedFixture = mkdtempSync(
  join(tmpdir(), 'skills-hub-downloaded-assets-'),
);
const preparedFixture = mkdtempSync(
  join(tmpdir(), 'skills-hub-prepared-assets-'),
);
const bundleFixture = mkdtempSync(join(tmpdir(), 'skills-hub-desktop-bundles-'));
const stagedFixture = mkdtempSync(join(tmpdir(), 'skills-hub-staged-desktop-'));
const tag = 'v0.1.2';
const version = tag.slice(1);
const assets = releaseAssetNames(tag);
const workflowArtifacts = new Map([
  ...[...cliArtifactTargets(tag)].map(([artifact, asset]) => [artifact, [asset]]),
  ...desktopArtifactTargets(tag),
]);
const nativeDesktopBundles = new Map([
  ['aarch64-apple-darwin', [['dmg', `Skills Hub_${version}_aarch64.dmg`], ['macos', 'Skills Hub.app.tar.gz'], ['macos', 'Skills Hub.app.tar.gz.sig']]],
  ['x86_64-apple-darwin', [['dmg', `Skills Hub_${version}_x64.dmg`], ['macos', 'Skills Hub.app.tar.gz'], ['macos', 'Skills Hub.app.tar.gz.sig']]],
  ['x86_64-unknown-linux-gnu', [['appimage', `Skills Hub_${version}_amd64.AppImage`], ['appimage', `Skills Hub_${version}_amd64.AppImage.sig`], ['deb', `Skills Hub_${version}_amd64.deb`], ['deb', `Skills Hub_${version}_amd64.deb.sig`]]],
  ['x86_64-pc-windows-msvc', [['nsis', `Skills Hub_${version}_x64-setup.exe`], ['nsis', `Skills Hub_${version}_x64-setup.exe.sig`], ['msi', `Skills Hub_${version}_x64_en-US.msi`], ['msi', `Skills Hub_${version}_x64_en-US.msi.sig`]]],
]);

try {
  for (const [target, entries] of nativeDesktopBundles) {
    const bundleDirectory = join(bundleFixture, target);
    const outputDirectory = join(stagedFixture, target);
    mkdirSync(bundleDirectory);
    for (const [bundle, filename] of entries) {
      const nativeDirectory = join(bundleDirectory, bundle);
      mkdirSync(nativeDirectory, { recursive: true });
      writeFileSync(join(nativeDirectory, filename), `fixture-${filename}`);
    }
    runScript('scripts/stage-desktop-release.mjs', [bundleDirectory, outputDirectory, tag, target]);
    assert.deepEqual(readdirSync(outputDirectory).sort(), desktopAssetsForTarget(tag, target).sort());
  }

  for (const [artifact, filenames] of workflowArtifacts) {
    const directory = join(downloadedFixture, artifact);
    mkdirSync(directory);
    for (const filename of filenames) writeFileSync(join(directory, filename), `fixture-${filename}`);
  }

  runScript('scripts/prepare-release-assets.mjs', [
    downloadedFixture,
    preparedFixture,
    tag,
  ]);
  assert.deepEqual(readdirSync(preparedFixture).sort(), [...assets].sort());
  runScript('scripts/check-release-assets.mjs', [preparedFixture, tag]);

  const currentNotes = join(downloadedFixture, 'current-notes.md');
  writeFileSync(currentNotes, '## Changes\n\n- Added signed updater artifacts.\n');
  runScript('scripts/generate-updater-json.mjs', [
    preparedFixture,
    tag,
    currentNotes,
    'yeyunwen/skills-hub',
    '2026-08-17T00:00:00Z',
  ]);
  runScript('scripts/check-release-assets.mjs', [preparedFixture, tag, '--with-updater-json']);
  const updaterJson = JSON.parse(readFileSync(join(preparedFixture, 'latest.json'), 'utf8'));
  assert.equal(updaterJson.version, version);
  assert.equal(updaterJson.pub_date, '2026-08-17T00:00:00.000Z');
  assert.match(updaterJson.platforms['darwin-aarch64'].url, /releases\/download\/v0\.1\.2/);
  assert.equal(updaterJson.platforms['windows-x86_64'].signature.startsWith('fixture-'), true);
  assert.match(updaterJson.platforms['windows-x86_64-msi'].url, /\.msi$/);
  assert.match(updaterJson.platforms['linux-x86_64-deb'].url, /\.deb$/);

  for (const asset of assets) {
    writeFileSync(join(fixture, asset), 'fixture');
  }

  runScript('scripts/check-release-assets.mjs', [fixture, tag]);
  runScript('scripts/check-release-assets.mjs', [fixture, tag, '--with-updater-json'], { succeeds: false });

  writeFileSync(join(fixture, 'latest.json'), 'fixture');
  runScript('scripts/check-release-assets.mjs', [fixture, tag, '--with-updater-json']);
  runScript('scripts/check-release-assets.mjs', [fixture, tag, '--with-updater-json', '--with-checksums'], { succeeds: false });

  writeFileSync(join(fixture, 'SHA256SUMS'), 'fixture');
  runScript('scripts/check-release-assets.mjs', [
    fixture,
    tag,
    '--with-updater-json',
    '--with-checksums',
  ]);

  writeFileSync(join(fixture, 'unexpected.bin'), 'fixture');
  runScript(
    'scripts/check-release-assets.mjs',
    [fixture, tag, '--with-updater-json', '--with-checksums'],
    { succeeds: false },
  );

  const renderedNotes = join(fixture, 'rendered-notes.md');
  runScript('scripts/render-release-notes.mjs', [
    currentNotes,
    renderedNotes,
  ]);
  runScript('scripts/render-release-notes.mjs', [
    renderedNotes,
    renderedNotes,
  ]);
  const notes = readFileSync(renderedNotes, 'utf8');
  assert.equal(
    notes.match(/skills-hub-release-preamble:start/g)?.length,
    1,
  );
  assert.match(notes, /## Changes/);
} finally {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(downloadedFixture, { recursive: true, force: true });
  rmSync(preparedFixture, { recursive: true, force: true });
  rmSync(bundleFixture, { recursive: true, force: true });
  rmSync(stagedFixture, { recursive: true, force: true });
}

console.log('Release tooling tests passed');
