# pi-session-memory

**Current version: 0.7.11**

## Install

```bash
pi install npm:pi-session-memory
```

Local-first cross-session & cross-agent dialogue search based on sqlite with optional local Jev semantic relevance filtering, or direct session migration from Claude Code and Codex to Pi, and optional Obsidian export, compatible in Chinese and English.

## What it does

- Indexes local Pi, Claude Code, and Codex JSONL transcript turns in local SQLite.
- Provides `recall_memory` for unconditional global literal search across every indexed turn. Its public interface accepts only topic entities and the complete question, so CWD, project, source, session, and time filters cannot restrict it.
- Provides `recall_project_memory` alongside direct recall whenever a current or named project is relevant: the project matches stored session CWD metadata and the identical bilingual topic entities search only those sessions.
- Provides `fetch_session` for read-only expansion of the smallest useful transcript range.
- Synchronizes changed history at Pi session start; the `/pi-session-memory` menu provides explicit full history import.
- Migrates current-project Claude Code or Codex sessions into separate native Pi sessions.
- Matches equivalent Windows project CWDs during migration, including `\\` versus `/`, drive-letter case, and trailing separators.

Search results are derived from stored source transcripts only and are never automatically injected into model context. Put project rules and preferences in `AGENTS.md`.

## Obsidian export

Obsidian export is optional and disabled by default: omit both `obsidianExportEnabled` and `obsidianVaultPath` to keep it disabled. To enable it, set `obsidianExportEnabled` to `true` and `obsidianVaultPath` to an existing vault directory. Every completed history search then writes its complete displayed result as one new root-level Markdown note, including searches with no matches. No result selection or Vault-path prompt is required. Each note receives a timestamp and UUID filename, so it never overwrites an existing note.

Obsidian export is intentionally a menu-only capability: it is not registered as an agent tool and is not added to agent context.

## What's new in 0.7.11

- **Uninterrupted project recall:** `recall_project_memory` no longer accepts source or time filters; it always searches every turn in sessions resolved from `project`.
- **Minimal project interface:** project recall now accepts only `project`, `entities`, and `question`.

## What's new in 0.7.10

- **Every-turn global recall:** `recall_memory` now has no CWD, project, source, session, or time scope; it always searches all indexed SQLite turns.
- **Unscopeable interface:** only `entities` and `question` remain in its public parameters, preventing agents from silently narrowing global searches.

## What's new in 0.7.9

- **Quiet disabled Jev:** when `jevEnable` is `false`, global and project recall show only recall results without the redundant Jev status section.
- **Diagnostics preserved:** Jev status remains visible when filtering is enabled, unavailable, or fails.

## What's new in 0.7.8

- **Guaranteed global recall:** `recall_memory` no longer exposes a CWD parameter and always searches every indexed project.
- **Dedicated project scope:** only `recall_project_memory` performs project-specific retrieval; call it alongside global recall when project context is relevant.
- **Consistent Jev review:** global `review_jev_filtered` audits cannot be accidentally restricted by the current CWD either.

## What's new in 0.7.7

- **Optional Obsidian configuration:** `obsidianExportEnabled` and `obsidianVaultPath` can both be omitted; export remains disabled by default. Configure a vault path only when explicitly enabling export.

## What's new in 0.7.6

- **Automatic per-search Obsidian notes:** with `obsidianExportEnabled`, every completed history search writes its complete result to one new Markdown note in `obsidianVaultPath` without selection.
- **No agent exposure:** Obsidian export is not registered as an agent tool and is not added to agent context.

## What's new in 0.7.5

- **Configuration-controlled Obsidian export:** configure its vault location with `obsidianExportEnabled` and `obsidianVaultPath`.
- **No agent exposure:** Obsidian export is not registered as an agent tool and is not added to agent context.

## What's new in 0.7.4

- **Explicit Obsidian export:** selectively write displayed recall results to new Markdown notes in an existing vault.
- **Safe writes:** exports require exact source turn IDs and refuse missing vaults, invalid selections, and existing target files.

## What's new in 0.7.3

- **Startup notifications:** history synchronization remains enabled, while the automatic sync summary is no longer displayed when a Pi session starts.
- **Operational notices:** synchronization errors and Jev availability status notifications remain visible.

## What's new in 0.7.2

- **Codex history compatibility:** import legacy transcripts with missing message IDs and distinguish child threads from their root session. Repeated turn metadata no longer causes duplicate turn keys.
- **Shared migration identities:** native-session migration uses the same deterministic message identity rules as indexing, preserving repeated messages.
- **Automatic index upgrade:** unchanged Codex files are reparsed once after the parser upgrade. Existing records are replaced transactionally without resetting the database. Back up the index if exact pre-upgrade restoration is required; record-based IDs are stable under append, but not earlier record insertions or removals.

## What's new in 0.7.0

- **One command only:** use the `/pi-session-memory` folded menu for help, release notes, storage status, global/project recall, history import, and session migration. The former standalone slash commands are removed.
- **Optional Jev filtering:** enable local Jev semantic review after literal ranking to filter keyword-only false positives; review failures keep literal recall active.
- **Expanded agent tools:** project-scoped recall, unified Claude Code/Codex migration, and `review_jev_filtered` are available through the Pi tool interface.
- **Package version:** updated to `0.7.0`.

Run `/pi-session-memory` in Pi to open the menu and access every user-facing capability.

## Commands

| Command | Description |
| --- | --- |
| `/pi-session-memory` | Open the selectable menu for help, release notes, status, recall, import, and migration. All user-facing actions are accessed from this menu. |

## Agent tools

| Tool | Use when |
| --- | --- |
| `recall_memory` | Always search every indexed SQLite turn using 2–8 specific literal topic entities, including Chinese and English equivalents. It cannot be restricted by CWD, project, source, session, or time. When project context is relevant, also call `recall_project_memory`. |
| `recall_project_memory` | Call alongside `recall_memory` whenever a current or explicitly named project is relevant. It accepts only `project`, identical bilingual `entities`, and `question`; it searches every turn in all resolved project sessions. Put the project name only in `project`, never in `entities`. |
| `fetch_session` | A recall excerpt lacks needed context. Fetch the smallest useful range. It is read-only. |
| `get_memory_stats` | The user asks how much local history is indexed. |
| `backfill_memory` | The user explicitly asks to import, backfill, or rescan history. |
| `migrate_project_sessions` | The user wants to continue current-project Claude Code or Codex work through `/resume`; omit `sources` to migrate both. |
| `review_jev_filtered` | Inspect possible Jev false negatives after recall, using the original bilingual entities and complete question. |

## Flow

```text
session_start -> syncChangedHistory() -> SQLite raw transcript index
no project context -> recall_memory(global, bilingual topic entities) -> matching raw transcript turns -> fetch_session (optional, read-only)
current or named project -> recall_memory(global, bilingual topic entities) + recall_project_memory(project metadata + identical bilingual topic entities) -> prioritize project-scoped turns or session candidates -> fetch_session (optional, read-only)
enabled export -> every completed history search -> one complete result Markdown note in the configured existing Obsidian vault
project migration command/tool -> native Pi session JSONL -> /resume
```

## JSON configuration

The extension reads its optional global configuration from:

```text
~/.pi/agent/pi-session-memory/config.json
```

Create or edit that JSON file to configure recall volume and optional Jev relevance filtering. Obsidian fields are not required:

```json
{
  "recallLimit": 20,
  "jevEnable": false,
  "model": "nimble"
}
```

To explicitly enable automatic Obsidian export, add both fields:

```json
{
  "obsidianExportEnabled": true,
  "obsidianVaultPath": "/absolute/path/to/existing/Obsidian Vault"
}
```

Configuration fields:

- `recallLimit`: required positive integer. `recall_memory` and `recall_project_memory` return at most this many ranked turns.
- `obsidianExportEnabled`: optional boolean; defaults to `false`. When `true`, every completed history search automatically writes one complete result note.
- `obsidianVaultPath`: required non-empty path when `obsidianExportEnabled` is `true`. It must identify an existing vault directory when a search is exported.
- `jevEnable`: optional boolean, default `false`. Set it to `true` to have local Jev review already-ranked turns against the complete user question and filter keyword-only false positives.
- `model`: optional Jev/Ollama model, default `nimble`. Allowed values are `nimble`, `tev1:4b`, and `tev1:0.8b`.

When Jev is enabled, the extension starts or reuses local Ollama and ensures the selected model is installed. Jev setup or request failures leave literal recall active. Existing files may omit `jevEnable` and `model` and receive the defaults above. Missing or invalid configuration raises an error instead of silently choosing a fallback.

Project-scoped topic search still examines every session whose CWD matches the project; `recallLimit` is applied after ranking, so older matching sessions remain searchable. When no project-scoped turn matches, at most `recallLimit` recent project-session candidates are returned instead.

History remains on the local machine, by default in `~/.pi/agent/memory.db`. Deleting that database removes only the index; restarting Pi rebuilds it from local source JSONL files.

## Migration compatibility

Migration selects sessions whose recorded project CWD is equivalent to the current Pi project CWD. On Windows, `C:\\Work\\app\\`, `C:/Work/app`, and differences only in path letter case are treated as the same project. Migrated sessions are written using the current Pi project CWD, so they appear under that project in `/resume`.

## Development

```bash
npm test          # core database, raw recall, importer, and migration regression suite
```
