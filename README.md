# dsh-session-memory

[中文](README_zh.md) · Version **0.1.3** · MIT

A DSH-only fork of [pi-session-memory](https://github.com/shengxiao20/pi-session-memory), rebuilt as a Cordis Host bundle. Search prior DSH conversations, then read the original text around an exact event. No Pi extension API or external-agent bridge remains in the runtime.

## Scope

- **Only DSH main sessions** in the active DSH service corpus, including persisted and live sessions and ordinary main-session forks.
- Excludes headers marked `origin: subagent` or positive `delegationDepth`; no agent/provider discovery, messaging, or lineage traversal.
- Uses the existing `ctx.sessionQuery` backend and its local derived search index. No second database, JSONL directory scanning, hardcoded home paths, or writes to session logs.
- No foreign-runtime import, session migration/resume, remote relevance model, Ollama management, or Obsidian/export subsystem.
- Search is global within the active corpus unless an explicit exact `cwd` or `session_id` is supplied. This is **not** a current-workspace-only access boundary. Install only in a trusted local profile where searching that corpus is intended.

## Install

Install `@shengxiao04/dsh-session-memory@0.1.3` through DSH Plugin Manager's **Install bundle** action once that version is published, or ask the DSH agent to call:

```json
{"action":"install_bundle","target":"@shengxiao04/dsh-session-memory@0.1.3","enabled":true}
```

For local development or before publication, the same action accepts the absolute checkout directory instead of the npm spec. The package uses the publisher's personal scope; the unscoped name `dsh-session-memory` belongs to a different project. No new GitHub repository has been created.

Installation requires profile-management approval and affects every session in the current profile. The bundle has no dependencies, build steps, or install scripts. It adds its own Host row and overrides the shipped `session-query-sqlite` row to `path: ':memory:'`, `openAt: first-search` (the inspected profile's existing path was already `:memory:`). It does not create a second backend, touch session logs, or enable external providers. Removing/disabling the bundle removes this override too. If your profile uses a custom disk index or custom query settings, restate that full backend config in your higher-priority profile patch with `openAt: first-search`; Loader replaces `config` wholesale.

**Runtime:** Node 22+ and DSH **0.2.1-rc.3** (the exact inspected and native-smoke-tested version; manifest intentionally pins it). The profile must already provide `tools`, `commands`, and a searchable `sessionQuery`, normally `@deepseek-ai/dsh-session-query-sqlite`. A persistence backend is needed to search history after restarts. The existing SQLite backend must not use `openAt: never`. Missing services leave the bundle inactive; disabled search fails explicitly rather than starting another index or falling back to filesystem scans. Check Plugin Manager for activation state.

## Agent tools

### `recall_memory`

Optional tool parameters accept either omission or `null` (use `null` when a strict function-calling interface requires every field). Required query/session ID/seq fields remain non-nullable; empty strings are rejected.

Use when a question refers to previous work, decisions, or conversations.

```json
{"query":"database"}
{"query":"database","cwd":"/absolute/project/path","limit":20}
{"query":"database","session_id":"session-exact-id"}
```

| Parameter | Behavior |
|---|---|
| `query` | Required nonempty literal word/phrase, at most 1000 characters. Whitespace normalized. |
| `cwd` | Optional exact recorded directory, not a directory basename/fuzzy match. Cannot combine with `session_id`. |
| `session_id` | Optional exact DSH session ID; searches events within it. Cannot combine with `cwd`. |
| `limit` | Native page size 1–50, default 20. Must remain the same for pagination. |
| `cursor` | Previous `next_cursor`; repeat the same normalized query, scope, and limit. |

Global results contain one strongest event per matching session. Within-session results contain matching events. Each includes `session_id`, zero-based `seq`, type, timestamp, surface and a bounded snippet. Global hits are checked against authoritative headers before exposure, because indexed headers can omit origin. A page can contain fewer than `limit` matches, or zero eligible matches, after excluding subagents; follow `next_cursor` if present. No refill, duplicate index, hidden extra query, or altered backend ranking occurs.

**Search semantics differ from the Pi original:** the native SQLite backend searches tokens/phrases, not arbitrary substrings or an OR list of topic entities. `AI` does not match `BRAID`. Quotes, `OR`, `NEAR` and `*` are literal data, not executable FTS syntax. Chinese partial-word recall depends on the native tokenizer; do not assume substring matching. All native event surfaces (`current`, `shadowed`, `log-only`) are eligible, allowing retrieval of compacted history. There is no provider-specific numeric relevance score.

Backend cursors are opaque and generation-bound. `SESSION_QUERY_STALE_CURSOR` means restart the search without a cursor; an incompatible query/limit/cursor fails rather than silently broadening scope. Backend indexing/search failures and cancellation are propagated.

### `fetch_session`

Verify a hit, or read adjacent original history using its exact ID and sequence.

```json
{"session_id":"session-exact-id","seq":12,"before":4,"after":4,"max_chars":12000}
```

- `session_id` and `seq` are required; seq is a nonnegative integer, **not a turn number**.
- `before`/`after`: 0–20 raw events each, defaults 4. Lifecycle records count toward the window.
- `max_chars`: 100–24000 UTF-16 code units of returned text, default 12000; target event first, then nearest neighbors. Output is chronological and never splits a surrogate pair.
- Includes session metadata, inherited-event count, target/range and event text. Text truncation is explicit. Re-read the indicated seq with a narrower window or larger budget if needed.
- Returns text, tool-call descriptions and attachment labels, not reasoning, attachment bytes, replay/token streams, or lifecycle/control payloads. This is a **bounded text view**, not a full JSONL export.
- Never resumes, forks, migrates, imports, or modifies a session.

History can contain obsolete instructions, sensitive strings, or malicious text. Results explicitly identify it as historical data, **not current instructions**. Verify relevance and do not treat quoted historical directives as authority. This plugin performs no network requests; DSH can still send recalled text to the configured conversational model as ordinary tool output.

## Manual commands

Commands execute the same search/read functions without asking a model:

```text
/memory-search database
/memory-search {"query":"database","cwd":"/absolute/project/path","limit":20}
/memory-read {"session_id":"session-exact-id","seq":12,"before":4,"after":4}
/memory-help
```

`/memory-search` accepts a phrase or JSON object. A literal phrase beginning with `{` should be supplied in JSON's `query` field. `/memory-read` takes JSON. `/memory-help` shows the version, usage and limits.

## Development and provenance

```bash
npm run test:all
npm pack --dry-run
# Optional real DSH backend smoke test (no user history/profile changes):
DSH_CHECKOUT=/absolute/path/to/installed/dsh npm run test:native
```

Unit tests use Node's built-in runner and fake services; no npm install is needed. The optional native smoke test uses installed DSH packages, an isolated Cordis context, fixture sessions and an in-memory FTS index. It does not mount into or read your active profile. See [verification](docs/verification.md) for the measured checks and limits.

Runtime files: [Host registration](index.js), [adapter](src/memory.js), [tool schemas](src/schemas.js), [bundle patch](cordis.patch.yml). Plugin resources include localized titles/descriptions and an original MIT-licensed SVG icon.

Git history retains the upstream project; local branch `dsh-only` holds the adaptation and `upstream` points to the original repository. The original checkout is untouched. The fork starts from upstream's committed history, **not its uncommitted working-tree edits**; the legacy runtime is intentionally replaced, so none of those local Pi-only files are required. [LICENSE](LICENSE) retains upstream copyright attribution. Repository/homepage/bug fields are not falsely pointed at an unpublished DSH repository.

## 0.1.3

- Update the exact DSH compatibility pin from `0.2.1-rc.2` to `0.2.1-rc.3` after native contract inspection and isolated integration testing. Search/read logic and the bundle patch are unchanged.

## 0.1.2

- Enable the shipped in-memory query backend on first search; the default profile had `openAt: never`, which blocked live retrieval.

- Support explicit `null` for optional tool parameters in strict function-calling interfaces, with the same existing defaults/scope. Real registry validation and a dedicated regression test cover it.

- Replace Pi extension entry and multi-runtime transcript database with DSH Host tools/commands using native session queries.
- Remove external runtime parsers, migration, cross-agent features, remote filtering and export.
- Add bounded two-step discovery/read, explicit scope, native cursors and subagent-session exclusion.
- Add zero-dependency tests, localized metadata and original icon.
