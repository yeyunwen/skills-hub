# skills-hub

`skills-hub` 是一个专注管理 AI Coding Agent Skills 的工具。它把 GitHub / GitLab / SSH Git / 本地目录里的 `SKILL.md` 统一扫描、选择性安装到 hub，再分发到 Codex、Claude、Cursor、OpenClaw 或远程设备。

> 当前 Rust 版是长期主线；早期 `packages/*` TypeScript 代码保留为 prototype 参考。

## 目标

- 统一 hub：`~/.agents/skills`
- 支持 GitHub / GitLab / generic Git / SSH Git / 本地目录
- 先扫描 source 中有多少 skill，再选择性安装
- 本机 agent 默认通过 symlink 分发
- 远程设备通过系统 SSH + rsync 同步
- 未来 Tauri GUI 直接复用 Rust core

## 开发环境

```bash
rustup update stable
cargo install just --locked
```

常用命令：

```bash
just fmt
just lint
just test
just check
just build
just run -- --help
```

## CLI 示例

初始化：

```bash
skh init
```

添加并扫描 GitLab SSH source：

```bash
skh source add git@gitlab.example.com:team/agent-skills.git --name agent-skills --branch main
skh source scan agent-skills
```

选择性安装：

```bash
skh install agent-skills --skill vant-use
skh install agent-skills --all
```

扫描 hub 与各 agent 目录：

```bash
skh scan
```

查看 hub 与各 agent 状态：

```bash
skh list
```

同步到本机 agent：

```bash
skh agent sync --tools codex,claude,cursor,openclaw --sync-method auto
```

迁移已有 Codex skills：

```bash
skh migrate --from codex
```

远程设备同步：

```bash
skh remote add office-mac --host office-mac.local --user dev
skh remote scan office-mac --tools codex,claude,cursor,openclaw
skh remote list office-mac --tools codex,claude,cursor,openclaw
skh remote sync office-mac --tools codex,claude,cursor,openclaw --sync-method auto --dry-run
```

## Rust 注释规范

本项目维护者主要是 Node.js 全栈，因此 Rust 代码必须保留关键中文注释：

- public struct / enum / function 需要 doc comment；
- Git clone/cache、symlink、migrate、remote sync 等关键流程要解释原因；
- 文件系统破坏性操作必须说明保护策略；
- 不要求逐行注释，避免噪音。

## 同步方式

`skills-hub` 的同步方式对齐 cc-switch 风格：

- `auto`：默认，优先 symlink，失败时 copy。
- `symlink`：强制 symlink，失败则报错。
- `copy`：强制复制。

本机 agent 同步：

```bash
skh agent sync --tools codex,claude,cursor,openclaw --sync-method auto
```

远程同步采用两段式：

```txt
local ~/.agents/skills  --rsync-->  remote ~/.agents/skills
remote ~/.agents/skills --symlink/copy--> remote agent skills dirs
```

示例：

```bash
skh remote sync office-mac --tools codex,claude,cursor,openclaw --sync-method auto --dry-run
```

## Desktop GUI

GUI 位于 `apps/desktop`，使用 Tauri v2 + Vite + React + TypeScript + shadcn 风格组件。

开发：

```bash
just desktop-dev
```

检查 Web 构建：

```bash
just desktop-check
```

构建桌面应用：

```bash
just desktop-build
```

首版 GUI 聚焦本机闭环：

```txt
Sources -> Hub -> Agents
```

Remote command 已在 Rust/Tauri 层预留，完整 Remote UI 放到下一阶段。
