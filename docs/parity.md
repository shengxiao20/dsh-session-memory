# Scope and logic alignment / 范围与逻辑对齐

Latest requirement: **DSH manages only its own sessions**. Pi source code is a logic reference, not a runtime history source. No Pi/Codex/Claude Code session discovery, parser/import, foreign transcript DB or session migration is provided.

| Retained logic | DSH-only implementation |
|---|---|
| Source-turn SQLite | `src/dsh-history-source.js` reads DSH persistence snapshots/handles; `src/history-index.js` builds user/assistant turns, stable DSH turn IDs and raw seq bounds |
| Literal entity OR/coverage ranking | SQLite substring OR, distinct matching-entity score, timestamp/stable-ID order; configured/call top K |
| Global → project → dedup | `src/entity-recall.js`: stored **DSH** CWD basename token matching, serial judgment, globally retained IDs only, no refill |
| Audit | Global/project literal union by turn_id, then a single judge pass; no cached recall |
| Source read / stats / explicit backfill | Recall, Jev audit, source reads, counts and full rebuild use `MemoryWorkflow`; persisted DSH turn reads/counts/full rebuild, no source writes |
| Multi-agent Discussion | `src/discussion.js`: Plugin Manager switch defaults off and applies live; `recall_memory` returns candidates and `discuss_memory` accepts 1–3 user-confirmed DSH main-session ranges; initiating model route; sequential isolated subagents; complete consultant prompt; no tools; source sessions unchanged; independent `fetch_session` verification |
| Local/remote Jev | Explicit root/model/Host key-variable/context, owned-child cleanup, visible unavailable/literal; credential/cancellation errors throw |
| Full visible source evidence | Budgeted escaped UTF-8 JSON segments/batches <=64, max noul threshold 0.5 before output truncation |
| Durable/lifecycle turn index | Plugin-owned `$DSH_HOME/dsh-session-memory/history.sqlite`, schema 2, WAL/NORMAL, private modes; `turn/end` waits for `sessions.flush` before refresh; config replacement drains/reuses without resync |
| Obsidian / configuration GUI | Explicit existing vault, owned wx/0600 note cleanup; actual bilingual ten-field staged plugin-row page |

## Host-surface difference / 宿主界面差异

Pi pauses `recall_memory` for its native TUI participant checklist. The inspected DSH rc.5 tool contract has no mid-tool user-selection API. DSH therefore separates candidate recall and confirmed consultation into `recall_memory` and `discuss_memory`. Evidence scope, participant isolation, routing, source immutability, and independent verification stay aligned. Invocation topology is not exact API parity.

Pi 的原生 TUI 能在 `recall_memory` 中暂停并选择参与者。已检查的 DSH rc.5 工具合约没有工具执行中的用户选择 API。因此 DSH 用 `recall_memory` 返回候选，再用 `discuss_memory` 接收确认后的咨询范围。证据范围、参与者隔离、模型路由、源会话不变和独立核验保持对齐；调用拓扑不宣称 API 完全相同。

DSH registers no slash commands. Plugin Manager is the configuration surface, and historical operations remain discoverable Agent tools. The earlier duplicate `/memory-*` command registrations were removed.

## Removed after scope correction / 按最新范围删除

- Removed `sessionQuery` injection, DSH FTS5 patch override, legacy `query/cwd/session_id/cursor` search mode and raw `seq/before/after` reads. The plugin now requires public `sessions` + `sessionPersistence`; turn-end refresh waits for the persistence durability barrier.
- `src/foreign-history-index.js`, `src/history-parsers.js`, `src/session-migration.js`.
- `migrate_project_sessions` and `/memory-migrate`, foreign output/source schemas and importer metadata.
- Native migration/parser tests and migration smoke script; removed direct released-V4 validator dependency and its 13 installed transitive packages.
- Kept native negative-isolation tests: malformed poison files under isolated `.pi/.claude/.codex` roots cannot affect DSH recall/backfill, and no migration tool/command is registered.

The withdrawn multi-source experiment used derived schema 1. DSH-only uses **schema 2** and refuses unknown/old derived versions rather than silently reading mixed-source rows or deleting a database. No active profile used the experiment; no real foreign history was imported or migrated during fixtures. No cleanup of other harness roots/databases is performed.

## Boundaries / 边界

Main-session filtering is scope, not authorization. Exact turn IDs/seq are coordinates retained from persisted DSH events; they are returned as provenance, not exposed as a raw-event query API. Entity mode uses full visible source turns and explicit Jev unavailability. No automatic vector memory/taxonomy/wiki/ontology generation or cross-host continuation.

Discussion defaults off and requires an explicit saved Plugin Manager switch. Enabling it permits later `discuss_memory` calls but does not start a model. Disabling it rejects new calls and cancels active Discussion work. Discussion does not resume a selected source session. Each participant is a separate DSH child Agent with `origin: subagent`, positive `delegationDepth`, no visible tools and no optional runtime context. DSH persists that local child log, but recall/backfill exclude it. Participants run sequentially and do not see each other's answers. `fetch_session` remains an independent main-Agent tool; Discussion never invokes it automatically or uses it as a fallback. Participant agreement is not verification.

Test results prove fixtures and inspected host contracts, not real models, remote credential deployment, production GUI YAML persistence/authorization or running-profile upgrades. Original Pi checkout remains unchanged. No commit/push/publication/profile restart/video render; existing architecture diagrams describe the 0.1.5 historical baseline.
