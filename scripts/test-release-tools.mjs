import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

for (const job of ['validate', 'verify']) {
  assert.match(
    workflowJob(releaseWorkflow, job),
    /^    permissions:\n(?:      .*\n)*?      contents: write\s*$/m,
    `${job} must have push-level visibility for the draft release`,
  );
}

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
const tag = 'v0.1.2';
const version = tag.slice(1);
const assets = [
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

try {
  for (const asset of assets) {
    writeFileSync(join(fixture, asset), 'fixture');
  }

  runScript('scripts/check-release-assets.mjs', [fixture, tag]);
  runScript(
    'scripts/check-release-assets.mjs',
    [fixture, tag, '--with-checksums'],
    { succeeds: false },
  );

  writeFileSync(join(fixture, 'SHA256SUMS'), 'fixture');
  runScript('scripts/check-release-assets.mjs', [
    fixture,
    tag,
    '--with-checksums',
  ]);

  writeFileSync(join(fixture, 'unexpected.bin'), 'fixture');
  runScript(
    'scripts/check-release-assets.mjs',
    [fixture, tag, '--with-checksums'],
    { succeeds: false },
  );

  const currentNotes = join(fixture, 'current-notes.md');
  const renderedNotes = join(fixture, 'rendered-notes.md');
  writeFileSync(currentNotes, '## Changes\n\n- Added release automation.\n');
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
}

console.log('Release tooling tests passed');
