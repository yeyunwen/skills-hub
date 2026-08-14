# 发布指南

本项目采用“两阶段发布”：版本变更必须先通过 PR 合并到 `main`，随后由维护者创建不可复用的 Tag 和 Draft Release；所有产物验证通过后，再将 Draft 发布为 immutable Release。

## 版本策略

- 使用 SemVer，Tag 格式为 `vX.Y.Z`；预发布版本使用 `vX.Y.Z-beta.N` 等格式。
- `0.x` 阶段：破坏性改动提升 minor，兼容修复提升 patch。
- 一个 Tag 只能对应一个提交和一组产物。构建失败或发布后发现问题时，修复后发布新版本，不移动旧 Tag、不替换已发布资产。

## 1. 准备版本 PR

从最新 `main` 创建分支，统一修改所有版本文件：

```bash
pnpm version:set 0.1.2
pnpm version:check 0.1.2
```

`version:set` 会同步 Rust workspace、CLI 内部依赖、`Cargo.lock`、根目录与 Desktop 的 `package.json`、Tauri 配置。版本 PR 还应确认：

- 用户可见改动和迁移说明已经进入文档；
- `pnpm-lock.yaml`、`Cargo.lock` 没有意外漂移；
- CI 的 `Rust check`、`Desktop check` 全部成功。

## 2. 创建 Tag 和 Draft Release

版本 PR 合并且 `main` CI 成功后，在 GitHub Actions 中从默认分支运行 **Cut Release**，输入 `vX.Y.Z`。

该工作流会：

1. 检查输入 Tag 与仓库中所有版本一致；
2. 确认当前 `main` 提交的 CI 已成功；
3. 确认版本高于仓库中已有的最高 SemVer Tag；
4. 拒绝已经存在的 Tag，避免覆盖历史版本；
5. 创建 annotated Tag 并推送；
6. 调度 **Release** 工作流构建 CLI 与 Desktop 安装包。

自动生成的是 annotated Tag，不在仓库中保存长期 GPG 私钥。产物身份由受保护的工作流、GitHub Actions 审计记录和 Sigstore-backed artifact attestation 共同证明；如果未来建立了可靠的密钥托管，再增加 signed Tag。

Release 工作流只创建 Draft，并执行以下供应链步骤：

- 构建 macOS、Windows、Linux CLI 和 Desktop 产物；
- 精确检查预期的 10 个产物，拒绝缺失、空文件或意外文件；
- 生成 `SHA256SUMS`；
- 生成 GitHub artifact attestation；
- 用固定的安全说明和自动生成的 changelog 创建 Draft Release。

## 3. 验收并正式发布

检查 Draft Release 的标题和自动生成的变更说明，然后从默认分支运行 **Publish Release**，输入相同 Tag。

发布工作流会重新下载 Release 资产，并再次验证：

- Tag 的提交属于 `main`；
- 10 个应用产物和 `SHA256SUMS` 的文件清单完全匹配；
- 所有 SHA-256 checksum 正确；
- 每个文件的 GitHub build provenance 有效。

全部通过后，稳定版会发布并设为 Latest；包含 `-beta`、`-rc` 等后缀的版本会作为 prerelease 发布。仓库启用了 Immutable Releases，正式发布后 Tag 和资产不能再修改。

## 手工恢复

正常情况不要手工打 Tag。如果 **Cut Release** 已经创建 Tag、但调度 Release 失败，可以从默认分支手工运行 **Release**，输入现有 Tag。不要删除或重建该 Tag。

如果 Draft 构建失败，先修复问题并准备下一个 patch/prerelease 版本。已经正式发布的 Release 不能重跑或替换资产。

## 代码签名

当前 Desktop 产物明确使用 `unsigned` 文件名，Release Notes 也会提示 Gatekeeper/SmartScreen 风险。后续配置签名时应使用 GitHub Environment secrets，并增加：

- macOS Developer ID 签名与 Apple notarization；
- Windows Authenticode 代码签名；
- 签名完成后的平台安装冒烟测试。

在签名链路真正生效并通过验证前，不要删除文件名和 Release Notes 中的 `unsigned` 标记。
