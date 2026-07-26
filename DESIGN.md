---
version: gamma
name: Codex Mono Console
description: |
  skills-hub 是本地 AI Coding Agent 技能管理器，视觉应接近 Codex Desktop / Raycast / Linear：
  黑白灰作为基础，不做花哨品牌背景；用一个克制的 Agent Green 作为主题色，承担当前选中、主按钮、focus ring、成功反馈。
  产品质感主要来自信息层级、紧凑列表、稳定交互状态，而不是大面积颜色或阴影。

principles:
  - Codex-like: 以黑白灰为主，界面安静、克制、像本地开发者工具。
  - Accent sparingly: 绿色只用于 active indicator、primary action、focus、成功态，不铺满页面。
  - Every async has feedback: 所有扫描/安装/同步/迁移/读取都必须有 loading、disabled、toast 或 skeleton。
  - Inventory over cards: Source、Hub、Agents、Remotes 优先是资源清单和状态矩阵，不是营销卡片。
  - Detail by selection: 列表保持紧凑，详情可通过后续 detail panel 展开。

colors:
  background: "#ffffff"
  sidebar: "#f7f7f8"
  surface: "#ffffff"
  surface-subtle: "#fafafa"
  surface-hover: "#f3f4f6"
  border: "#e5e7eb"
  border-strong: "#d1d5db"
  ink: "#111827"
  body: "#374151"
  muted: "#6b7280"
  muted-soft: "#9ca3af"
  primary: "#111827"
  primary-hover: "#1f2937"
  accent: "#10a37f"
  accent-hover: "#0d8f70"
  accent-soft: "#ecfdf5"
  on-primary: "#ffffff"
  danger: "#ef4444"
  danger-soft: "#fef2f2"
  warning: "#f59e0b"
  warning-soft: "#fffbeb"
  info: "#2563eb"
  info-soft: "#eff6ff"

layout:
  sidebar-width: 248px
  content-max-width: 1240px
  page-padding: 28px
  row-height: 52px
  radius: 10px

typography:
  sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  mono: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace"
  page-title: "28px / 1.15 / 650 / -0.03em"
  panel-title: "15px / 1.35 / 650"
  body: "14px / 1.5 / 400"
  caption: "12px / 1.4 / 500"

components:
  sidebar:
    active: white background + left 2px accent bar + dark text
    hover: subtle gray background
    bottom-card: always visible, never hidden by page scroll
  command-bar:
    position: top of content
    visual: rounded border input, command shortcut badge
    actions: search placeholder, refresh/sync quick action later
  button:
    primary: dark text surface or accent depending context
    pending: spinner + disabled
  table:
    row: compact border-bottom row
    hover: surface-hover
    selected: accent-soft with left accent bar
  toast:
    top-right
    loading spinner
    success uses accent
