# pi-session-memory（中文）

[English](README.md)


`pi-session-memory` 是本地优先的跨会话、跨 Agent 对话检索插件。它会将本机 Pi、Claude Code 和 Codex 的 JSONL 对话轮次索引到本地 SQLite；可选地使用本地 Jev 模型进行语义相关性筛选、将 Claude Code/Codex 会话迁移为 Pi 原生可在 `/resume` 中继续的会话，并将检索结果导出到 Obsidian。

## Install（安装）

```bash
pi install npm:pi-session-memory
```

## What it does / Commands（功能与命令）

- 索引仅保存在本机 SQLite，不上传对话内容。
- `recall_memory` 全局搜索所有已索引的对话轮次；提出与历史工作或以往对话相关的问题时，应同时调用 `recall_project_memory`，并为两个工具传入相同的字面主题实体和完整问题。
- `recall_project_memory` 先通过实体匹配存储的项目/会话 CWD 目录名，再只检索匹配会话；它不使用当前运行时、当前项目或当前 CWD 作为隐式范围。
- `review_jev_filtered` 用于审查 Jev 筛掉的候选项；`migrate_project_sessions` 可将 Claude Code 和/或 Codex 的匹配项目会话迁移到 Pi；`get_memory_stats` 报告已索引历史总量；`backfill_memory` 仅在明确要求导入、回填或重扫历史时使用。
- 可在配置中启用本地 Jev 相关性筛选和 Obsidian 导出。未显式启用 Obsidian 时不会导出。

## Flow and migration compatibility（工作流程与迁移兼容性）

检索会先在 SQLite 中执行字面匹配，再按配置选择是否以本地 Jev 语义筛选结果。迁移只选择其记录的项目 CWD 与当前 Pi 项目 CWD 等价的会话；在 Windows 上，路径分隔符、尾部斜杠和盘符大小写的差异会被视为相同。迁移后的会话会写入当前 Pi 项目 CWD，因此可在该项目的 `/resume` 中看到。

完整的英文配置字段、命令参数、工具使用约束、Obsidian 导出行为和版本更新记录见上方英文文档。

## Development（开发）

```bash
npm test
```
