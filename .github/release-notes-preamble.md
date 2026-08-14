## Downloads

- **macOS Apple Silicon:** the `darwin-aarch64-unsigned.dmg` asset
- **macOS Intel:** the `darwin-x64-unsigned.dmg` asset
- **Windows x64:** the `windows-x64-unsigned-setup.exe` or `.msi` asset
- **Linux x64:** the `linux-amd64-unsigned.AppImage` or `.deb` asset
- **CLI only:** the `skh-...` archive matching your target triple

> [!WARNING]
> Desktop installers are currently **unsigned and unnotarized**. macOS Gatekeeper and Windows SmartScreen may display a warning. Verify the checksum or GitHub attestation before opening an unsigned build.

## Verify downloads

`SHA256SUMS` covers every CLI archive and Desktop installer. All release files, including the checksum file, are covered by GitHub build provenance.

```sh
# macOS
shasum -a 256 -c SHA256SUMS

# Linux
sha256sum -c SHA256SUMS

# Any platform with GitHub CLI
gh attestation verify <downloaded-file> --repo yeyunwen/skills-hub
```

On Windows, compare `Get-FileHash <downloaded-file> -Algorithm SHA256` with the corresponding entry in `SHA256SUMS`.
