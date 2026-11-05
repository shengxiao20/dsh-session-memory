# Verification — DSH-only 0.3.0 working tree

## Requirement and environment

Checked **2026-11-05 UTC+8**, Node **v22.22.2**, npm **10.9.7**, installed DSH **0.2.1-rc.5**. Package/lock working version **0.3.0**, DSH contract pinned to rc.5.

Latest scope: **persisted DSH sessions only**, with sequential multi-agent Discussion over one to three user-confirmed DSH main-session evidence ranges. No `sessionQuery` injection/call/config override, DSH FTS5, token/phrase compatibility search, raw-event read API, Pi/Codex/Claude Code history discovery/import, foreign DB access or session migration. The original `../pi-session-memory` checkout is only a logic reference.

No commit, push or 0.3.0 npm publication was performed; npm `latest` is the published 0.2.3 with the same rc.5 Host contract. The active Web profile uses registry 0.2.3 with HMR explicitly enabled; this 0.3.0 working tree was verified in isolated unit/native/browser fixtures and was not substituted into the active profile. An independent Remotion Studio preview exists; no MP4 rendered. Foreign-root fixtures use isolated temporary HOME directories, never real user transcripts.

## Current verification

```sh
npm ci --ignore-scripts --cache "$PWD/.npm-cache"
npm run test:all
DSH_CHECKOUT="$(npm root -g)/@deepseek-ai/dsh" npm run test:native
DSH_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
npm pack --dry-run --json --cache "$PWD/.npm-cache"
git diff --check
```

- **58/58 unit tests PASS**: build/syntax, source-turn recall/read, DSH persistence adapter, multi-agent Discussion isolation/routing, Jev, durable index/lifecycle, UI/config, mixed-schema refusal, redacted tool-result configuration snapshots, and a single version-free `/memory-status` JSON response.
- Both native smokes **PASS** with actual rc.5 `Sessions`, `Agents`, JSONL `sessionPersistence`, `Tools`, `Commands`, and Loader/Settings/ClientModuleRegistry. Neither smoke loads session-query-sqlite. Native registration is verified without a real model call; Discussion model behavior uses a deterministic Agent fixture and inspected rc.5 contracts.
- Browser smoke **PASS** in Chrome with the built client; Host form and Plugin Manager layout remain fixtures.
- Pack dry-run contains **44 files**. It includes `src/discussion.js`, `CHANGELOG.md`, `src/dsh-history-source.js`, `src/tool-config-summary.js`, and tests; it excludes foreign/migration modules, history DBs, vault/cache/evidence, node_modules and deleted root AGENTS.md.
- `git diff --check` **PASS**.

Logs: `/tmp/dsh-memory-0.3.0-unit.log`, `/tmp/dsh-memory-0.3.0-native.log`, `/tmp/dsh-memory-0.3.0-browser.log`, `/tmp/dsh-memory-0.3.0-pack.json`. The 0.2.3 package remains separate deployed evidence; earlier test/file snapshots cover prior or withdrawn designs and are not current evidence.

## Active-profile smoke

- Global `dsh --version` is **0.2.1-rc.5**; its base, Web and HMR packages are all rc.5.
- The former rc.3 Web process exited via SIGINT in two seconds before global packages or the profile were changed.
- The active profile installs registry `@shengxiao04/dsh-session-memory@0.2.3` and declares DSH rc.5. The profile patch explicitly sets both `hmr.disabled: false` and `dsh-session-memory.disabled: false`; the known `sessionController`/resolver reload risk remains relevant to future profile changes.
- The active 0.2.3 profile is the screenshot/runtime baseline and still contains its old status version prefix. The 0.3.0 source keeps both the `VERSION` export and package-version text out of `/memory-help` and `/memory-status`; it is not claimed active before publication and upgrade.
- This smoke deliberately used a local command rather than an LLM prompt. Provider quality, credential availability and model-side cancellation propagation are not claimed by it.

## Persistence and index guarantees tested

- Required Host contracts are exactly `sessions`, `sessionPersistence`, `agents`, `tools`, `commands`; recall/read schemas contain only entity/question/limit search and inclusive turn reads. Discussion requires one to three exact main-session IDs, inclusive ranges, a complete question and an optional bounded character budget. Removed `query/cwd/session_id/cursor` search and `seq/before/after` read fields fail explicitly.
- `/memory-status` has exactly one command registration and one JSON result per invocation. It contains no package-version field or text prefix; package metadata remains solely in `package.json`. Repeated rows in one DSH session therefore prove repeated command invocations, not duplicate plugin rendering.
- All six tools append a second invocation-time text block with Jev enabled/model/runtime state, Obsidian, `manageOllama`, recall limit, `DSH_HOME` set/unset, and the configured API-key variable set/unset. The structured output/schema and command text are unchanged. Tests prove credentials, endpoint, vault, database and filesystem path values are absent; status errors propagate instead of being hidden.
- Discussion participants run sequentially with the initiating Agent's provider/model. Each gets a complete consultant prompt, an empty tool allow-list, suppressed optional runtime context and only its bounded source evidence. Selected source sessions remain unchanged. Child logs use `origin: subagent` plus positive `delegationDepth`, so index refresh and backfill exclude them.
- Discussion returns explicit evidence turn IDs and truncation status. It states that agreement is not verification. `fetch_session` remains independently registered for exact source checks and is never invoked automatically or used as fallback.
- `DshHistorySource` calls public `sessionPersistence.list`, `open(id, 'read')`, `handle.read`, and always awaits `handle.close`, including read failure. It does not parse physical JSONL/compression artifacts.
- A `turn/end` hook waits for `sessions.flush(session)` before index refresh. A missing persistence participant throws visibly; no fallback source is selected.
- DSH persistence under `$DSH_HOME/sessions` is authoritative. The only plugin index is `$DSH_HOME/dsh-session-memory/history.sqlite`, storage label `plugin-owned-durable-sqlite`, schema 2, WAL/NORMAL and DB/WAL/SHM 0600.
- Stable `dsh:<session_id>:<user-seq>` IDs, inclusive turn indices and source event seq bounds; image-only users occupy indices without searchable text. Visible assistant text/tool names are retained; reasoning, binary attachments and tool-result payloads are omitted.
- Full header/event hashes detect changed cuts with reused counts/seq. Changed sessions replace, missing/excluded sessions prune, failures/cancellation roll back the active transaction. A schema-1 poison DB is refused and left unchanged.
- Literal substring OR, distinct-entity coverage (not frequency), timestamp/stable-ID order. `AI` can match `BRAID`; there is no alternate FTS behavior.
- Project discovery uses only persisted DSH CWD basenames. Ordinary Global judgment precedes Project and deduplicates only globally retained IDs, without refill. Audit unions literal turns by ID before one judgment.
- Jev receives complete visible source turns before output truncation, uses escaped-JSON UTF-8 budgeted segments and batches <=64, then maximum noul threshold 0.5. Model failures become explicit unavailable/literal; credential/config/caller-cancellation errors throw.
- Reconfiguration cancels/drains model/export work and reuses the index without history synchronization. Search/read/stats still synchronize explicitly; unload drains owned work and closes the DB.
- Malformed poison files under isolated `.pi/.claude/.codex` roots do not affect recall/backfill and remain byte-identical.

## Integration evidence vs fixtures

Native persistence tests create isolated real DSH persistence handles and use real durability barriers; they do not access the active profile. Local/remote decision endpoints are fixtures, so model quality and production authorization are not claimed. Native Settings/Loader is real, while profile editing is an in-memory adapter. Browser source/page is real, while surrounding Host form/layout is a fixture.

Obsidian remains opt-in: existing absolute vault, unique wx/0600 bounded Markdown, cleanup of owned partial files. It does not generate AGENTS, rules, Wiki, Ontology or graph links.

Remotion part 5 now shows `sessionPersistence → visible turns → plugin-owned SQLite`; part 7 states there is no FTS/legacy/raw-event search branch. Studio checks pass for 14 full-scene samples, 14 standalone chapter views, 27 boundaries, safe areas/overflow and zero page errors. No render claim.

See [scope tracking](parity.md). Existing `.archify` diagrams remain the 0.1.5 historical baseline, not current architecture evidence.
