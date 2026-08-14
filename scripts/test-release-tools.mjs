import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');

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
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log('Release tooling tests passed');
