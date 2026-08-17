export const TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function releaseVersion(tag) {
  if (!TAG_PATTERN.test(tag)) throw new Error(`invalid release tag: ${tag}`);
  return tag.slice(1);
}

export function cliArtifactTargets(tag) {
  releaseVersion(tag);
  return new Map([
    ['release-cli-aarch64-apple-darwin', `skh-${tag}-aarch64-apple-darwin.tar.gz`],
    ['release-cli-x86_64-apple-darwin', `skh-${tag}-x86_64-apple-darwin.tar.gz`],
    ['release-cli-x86_64-pc-windows-msvc', `skh-${tag}-x86_64-pc-windows-msvc.zip`],
    ['release-cli-x86_64-unknown-linux-gnu', `skh-${tag}-x86_64-unknown-linux-gnu.tar.gz`],
  ]);
}

export function desktopAssetsForTarget(tag, target) {
  const version = releaseVersion(tag);
  const targets = {
    'aarch64-apple-darwin': [
      `skills-hub-v${version}-darwin-aarch64-unsigned.dmg`,
      `skills-hub-v${version}-darwin-aarch64-updater.app.tar.gz`,
      `skills-hub-v${version}-darwin-aarch64-updater.app.tar.gz.sig`,
    ],
    'x86_64-apple-darwin': [
      `skills-hub-v${version}-darwin-x64-unsigned.dmg`,
      `skills-hub-v${version}-darwin-x64-updater.app.tar.gz`,
      `skills-hub-v${version}-darwin-x64-updater.app.tar.gz.sig`,
    ],
    'x86_64-unknown-linux-gnu': [
      `skills-hub-v${version}-linux-amd64-unsigned.AppImage`,
      `skills-hub-v${version}-linux-amd64-unsigned.AppImage.sig`,
      `skills-hub-v${version}-linux-amd64-unsigned.deb`,
      `skills-hub-v${version}-linux-amd64-unsigned.deb.sig`,
    ],
    'x86_64-pc-windows-msvc': [
      `skills-hub-v${version}-windows-x64-unsigned-setup.exe`,
      `skills-hub-v${version}-windows-x64-unsigned-setup.exe.sig`,
      `skills-hub-v${version}-windows-x64-unsigned.msi`,
      `skills-hub-v${version}-windows-x64-unsigned.msi.sig`,
    ],
  };
  const assets = targets[target];
  if (!assets) throw new Error(`unsupported desktop release target: ${target}`);
  return assets;
}

export function desktopArtifactTargets(tag) {
  return new Map([
    ['release-desktop-aarch64-apple-darwin', desktopAssetsForTarget(tag, 'aarch64-apple-darwin')],
    ['release-desktop-x86_64-apple-darwin', desktopAssetsForTarget(tag, 'x86_64-apple-darwin')],
    ['release-desktop-x86_64-unknown-linux-gnu', desktopAssetsForTarget(tag, 'x86_64-unknown-linux-gnu')],
    ['release-desktop-x86_64-pc-windows-msvc', desktopAssetsForTarget(tag, 'x86_64-pc-windows-msvc')],
  ]);
}

export function releaseAssetNames(tag, { withUpdaterJson = false, withChecksums = false } = {}) {
  const assets = [
    ...cliArtifactTargets(tag).values(),
    ...[...desktopArtifactTargets(tag).values()].flat(),
  ];
  if (withUpdaterJson) assets.push('latest.json');
  if (withChecksums) assets.push('SHA256SUMS');
  return assets;
}

export function updaterPlatforms(tag) {
  const version = releaseVersion(tag);
  return [
    {
      keys: ['darwin-aarch64', 'darwin-aarch64-app'],
      asset: `skills-hub-v${version}-darwin-aarch64-updater.app.tar.gz`,
    },
    {
      keys: ['darwin-x86_64', 'darwin-x86_64-app'],
      asset: `skills-hub-v${version}-darwin-x64-updater.app.tar.gz`,
    },
    {
      keys: ['linux-x86_64', 'linux-x86_64-appimage'],
      asset: `skills-hub-v${version}-linux-amd64-unsigned.AppImage`,
    },
    {
      keys: ['linux-x86_64-deb'],
      asset: `skills-hub-v${version}-linux-amd64-unsigned.deb`,
    },
    {
      keys: ['windows-x86_64', 'windows-x86_64-nsis'],
      asset: `skills-hub-v${version}-windows-x64-unsigned-setup.exe`,
    },
    {
      keys: ['windows-x86_64-msi'],
      asset: `skills-hub-v${version}-windows-x64-unsigned.msi`,
    },
  ];
}
