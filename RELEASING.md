# 发布指南

本项目使用 Release Please 驱动社区发布流程：机器人根据 Conventional Commits 持续维护 Release PR；维护者合并 Release PR 后，系统自动创建 Tag 和 Draft Release、构建并验证所有产物，最后只保留一次受保护的发布审批。

正常流程不需要手工修改版本号、创建 Tag 或运行发布 workflow。

## 1. 日常开发

所有改动通过 PR 合并到 `main`，PR/提交标题遵循 Conventional Commits：

- `fix:`：patch 版本，例如 `0.1.1 → 0.1.2`；
- `feat:`：minor 版本，例如 `0.1.2 → 0.2.0`；
- `feat!:`、`fix!:` 或正文中的 `BREAKING CHANGE:`：`0.x` 阶段提升 minor；
- `docs:`、`build:`、`ci:`、`chore:`：进入 changelog，但不会单独触发版本提升。

## 2. Release PR

每次 `main` 更新后，**Release Please** workflow 会创建或更新一个 Release PR。它负责：

- 根据 Conventional Commits 计算下一个 SemVer；
- 更新 `version.txt` 和 `.release-please-manifest.json`；
- 更新 `CHANGELOG.md`；
- 调用仓库版本同步脚本，更新 Rust workspace、内部 crate 依赖、`Cargo.lock`、根目录与 Desktop 的 `package.json`、Tauri 配置；
- 显式调度 Release PR 最新提交的 `Rust check` 和 `Desktop check`。

维护者只需要检查版本、CHANGELOG 和 CI，然后合并 Release PR。需要指定版本时，在普通提交正文中使用：

```text
Release-As: 0.3.0
```

`pnpm version:set <version>` 只作为本地检查和故障恢复工具，不是正常发布入口。

## 3. 自动构建 Draft Release

Release PR 合并后，Release Please 会创建 `vX.Y.Z` Tag 和 Draft Release，并显式调度 **Release** workflow。Release workflow 会自动：

1. 验证 Tag 对应提交属于受保护的 `main`；
2. 验证 Tag、`version.txt`、Cargo、Node 和 Tauri 版本完全一致；
3. 构建 4 个 CLI 包、6 个 unsigned Desktop 安装包，以及 8 个 updater 包或签名；
4. 精确检查 18 个基础产物，拒绝缺失、空文件或意外文件；
5. 根据 Draft Release 内容和最终资产名称生成 `latest.json`；
6. 生成 `SHA256SUMS` 和 GitHub artifact attestation；
7. 上传到 Release Please 创建的 Draft，并补充下载、安全和验证说明；
8. 重新下载全部 20 个 Release 资产，验证 checksum 与 provenance。

## 4. 一次发布审批

全部验证通过后，workflow 会进入受保护的 `release` GitHub Environment。维护者在 Actions 页面批准 deployment 后：

- 稳定版发布并设为 Latest；
- prerelease 保持 prerelease 且不设为 Latest；
- 仓库的 Immutable Releases 立即生效，Tag 和资产不能再修改。

这是正常发布过程中唯一需要在 Release PR 合并之后进行的人工操作。

## 失败恢复

- Release PR CI 失败：直接修复 Release PR 或 `main`，Release Please 会继续更新同一个 PR。
- Draft 构建因 workflow/runner 临时错误失败：从 `main` 手工重新运行 **Release**，输入已有 Tag。
- Tag 对应的代码本身无法构建：修复后走下一个 patch/prerelease 版本；不要移动或复用旧 Tag。
- 已正式发布后发现问题：发布新 patch 版本，不替换旧资产。

## 代码签名

### Updater 签名

Tauri updater 使用独立的 minisign 密钥验证自动更新包：

- 公钥提交在 `apps/desktop/src-tauri/tauri.conf.json`；
- 私钥保存在 GitHub Actions Repository Secret `TAURI_SIGNING_PRIVATE_KEY`；
- 当前维护机备份位于 `~/.tauri/skills-hub-updater.key`，权限必须保持为 `0600`；
- 私钥不得提交到仓库、日志或 Release 资产；丢失私钥后，已经安装的旧客户端将无法信任后续更新。

更新端点固定为稳定版 GitHub Release 的 `latest.json`。Prerelease 不会被稳定版客户端通过该端点自动安装。

在第一个包含 updater 产物的新版本发布前，旧的 Latest Release 不存在 `latest.json`；客户端会显示“更新通道将在下一个正式版本发布后启用”，而不是把这个引导阶段显示为网络错误。

### 平台代码签名

当前 Desktop 产物明确使用 `unsigned` 文件名，Release Notes 也会提示 Gatekeeper/SmartScreen 风险。macOS 构建使用 Tauri 的 ad-hoc identity `-` 对完整 app bundle 签名，避免浏览器下载后因无有效 bundle 签名被报告为“已损坏”；这不等同于受信任的 Developer ID 签名或 Apple 公证。后续签名材料应放在 `release` GitHub Environment secrets 中，并增加：

- macOS Developer ID 签名与 Apple notarization；
- Windows Authenticode 代码签名；
- 签名完成后的平台安装冒烟测试。

签名链路真正生效并通过验证前，不要删除文件名和 Release Notes 中的 `unsigned` 标记。
