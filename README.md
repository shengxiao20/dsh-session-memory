# dsh-session-memory

[中文](README_zh.md) · Working version **0.3.1** · MIT

Cordis Host adaptation of [pi-session-memory](https://github.com/shengxiao20/pi-session-memory), preserving MIT attribution. Uses Pi-style turn retrieval logic, but **manages only DSH's own main sessions**. No Pi/Codex/Claude Code discovery, transcript parsers/import, foreign database access or session migration. The original Pi checkout is a code reference, not a runtime history source.

The npm `latest` release is 0.2.3 with the verified DSH 0.2.1-rc.5 Host contract. This 0.3.1 working tree adds tool-free sequential multi-agent Discussion over user-confirmed DSH evidence ranges. It also keeps redacted invocation-time tool snapshots. Publishing 0.3.1 remains a separate authenticated release step. A separate Remotion Studio preview exists; no MP4 was rendered.

## Pi alignment boundary

The evidence rules align with Pi. The invocation topology does not claim exact API parity.

Pi can pause `recall_memory` and show a native TUI participant checklist. The inspected DSH rc.5 tool contract has no equivalent mid-tool user-selection API. DSH therefore uses two Agent tool calls: `recall_memory` returns candidates, then `discuss_memory` accepts the user-confirmed ranges. This is a deliberate Host adaptation, not residual Pi code.

DSH registers no slash commands. Recall, Discussion, source reads, statistics, and backfill are Agent tools. Plugin Manager provides configuration. This removes the earlier `/memory-*` duplicate command surface.

## Invocation tree

```text
recall_memory
├─ entities + complete question
│  ├─ DSH sessionPersistence.list / open / read
│  ├─ persisted DSH user/assistant turns → plugin-owned durable SQLite
│  ├─ Global: substring OR → entity coverage ranking → top K → optional Jev
│  ├─ Project: entities match stored DSH CWD basename token sequences
│  │  └─ discovered DSH sessions → same ranking/top K → optional Jev
│  └─ remove project turn_ids actually returned globally; no refill

User confirms 1–3 session IDs and inclusive evidence ranges
└─ discuss_memory
   ├─ historical DSH participants run sequentially
   ├─ complete consultant prompt + no tools + no optional runtime context
   ├─ participants receive bounded visible source turns and never see each other's answers
   └─ private answers return to the initiating main Agent for comparison

review_jev_filtered
└─ literal global/project union by turn_id → judge once → filtered-out turns

fetch_session
└─ exact persisted DSH session_id + inclusive turn indices → visible source text

get_memory_stats → synchronize persisted snapshots → DSH totals
backfill_memory → explicitly rebuild persisted DSH turn index
```

No embeddings, memory-writing prompts, taxonomy or vector service. Index stores source text, not classified facts/preferences/rules. History is **untrusted data, not current instructions**.

## Persisted DSH history and the plugin index

There is one plugin-owned derived SQLite index; it is not authoritative:

```text
$DSH_HOME/sessions (DSH persistence; authoritative)
└─ public sessionPersistence.list / open(read) / handle.read
   └─ plugin-maintained source-turn SQLite → $DSH_HOME/dsh-session-memory/history.sqlite
      └─ entity substring OR, project discovery, ranking, exact turn reads and stats
```

- The plugin requires DSH `sessions` and `sessionPersistence`; it does not inject, configure or call `sessionQuery`, and does not mount DSH FTS5. DSH persistence abstracts the physical JSONL/compression format; the plugin never parses storage artifacts directly.
- The plugin DB defaults to `$DSH_HOME/dsh-session-memory/history.sqlite`, otherwise `~/.dsh/dsh-session-memory/history.sqlite`. The plugin owns its connection and incremental synchronization from persistence snapshots/read handles. Directory is `0700`, DB/WAL/SHM `0600`, WAL and `synchronous=NORMAL`.
- The index is a rebuildable view. DSH persistence under `$DSH_HOME/sessions` remains authoritative. The plugin never writes source logs, scans project files, or accesses another harness's database.
- At `turn/end`, the plugin first awaits `sessions.flush(session)` as the DSH durability barrier, then refreshes its index. Search/read/stats synchronize again. Every read handle is closed. Changes replace complete derived turns, missing sessions prune the index, forced backfill reparses all persisted sessions.
- Native updates are transactional; errors/cancellation roll back the active update and throw. Unknown derived schema versions are refused, not silently migrated or discarded. This working version uses schema **2**, keeping the withdrawn multi-source experimental schema out of DSH-only queries.
- Model configuration replacement cancels/drains old work and reuses the index without model startup or history synchronization. Unload waits for owned work before closing its DB; no foreign-root discovery/import/migration code is installed.
- Authoritative headers exclude `origin: subagent` or positive `delegationDepth`; main forks remain eligible. Discussion creates short-lived DSH subagents with both markers, so their locally persisted consultation logs never enter recall. The plugin does not modify any selected source session. Scope filters are **not authorization**. Model-only replacement surface copies do not become extra transcript turns; append-origin historical text remains searchable.

## Retrieval semantics

`entities`: 2–8 literal topic strings, at least two distinct after trim/lowercase; `question`: complete user question, max 1000 characters. SQLite `instr(lower(user_text || ' ' || reply_text), entity) > 0`, OR across entities. Built-in case folding is ASCII; other Unicode remains literal. `AI` can match `BRAID`, `card` can match `wildcard`; punctuation is data, not FTS operators.

Each distinct matching entity adds one point—not frequency. Order: coverage descending, user timestamp descending, stable turn ID. `limit`: **per stage** 1–50, default `recall.limit` (20). No refill after filtering/dedup. Entity recall has no cursor and accepts only `entities`, complete `question`, and optional `limit`.

Project discovery only uses entities and **stored DSH CWD final-directory token sequences**, never implicit current runtime/project/session/time. Bounded project candidates can appear even when no transcript literal matches. Ordinary recall filters global then project serially and removes only actually retained global turn IDs. Audit unions literal candidates first, judges once; no cached recall output.

Turn ID: `dsh:<session_id>:<user-event-seq>`. Exact inclusive `seq/end_seq` are source-event coordinates. Textual users start slices; image-only users occupy an index/end preceding ownership without becoming searchable text. Visible assistant text is aggregated, tool names retained. Thinking, binary attachments and tool-result payloads are omitted.

Search unique results share a 24000 UTF-16 source-text budget plus bounded 500-unit excerpts, truncation explicit. Jev sees full visible source-turn text **before** output truncation. Fetch exact turn coordinates for more context.

## Multi-agent Discussion

Multi-agent Discussion is **off by default**. First enable **Multi-agent Discussion → Enable Discussion** in Plugin Manager and save. The setting applies live. Disabling it rejects new `discuss_memory` calls and cancels active Discussion work.

Call `discuss_memory` only after the user confirms one to three session IDs and inclusive evidence ranges returned by `recall_memory`. Every participant uses the initiating main Agent's exact provider/model route. Participants run **sequentially**, not in parallel.

Each participant receives only its selected visible source turns and the complete question. A complete consultant system prompt treats history as untrusted evidence. Agent-scoped restrictions expose no tools and suppress optional runtime context. Participants cannot see another participant's answer. The main Agent receives all private answers and remains responsible for comparison and final judgment.

Discussion never resumes or writes a selected source session. DSH creates a separate short-lived subagent session for each model call. Its local persistence record is marked `origin: subagent` with positive `delegationDepth`, so recall and backfill exclude it. This is local isolation, not ephemeral storage.

Participant agreement does not verify a fact. `fetch_session` remains independently available to inspect exact persisted source context. Discussion never invokes it automatically and never uses it as a silent fallback. Evidence ranges allow at most 20 turns. `max_chars` is 100–24000 per participant and reports truncation explicitly.

## Agent tools

| Tool | Purpose |
|---|---|
| `recall_memory` | Global/project entity recall over persisted DSH turns |
| `discuss_memory` | Sequential, isolated consultation with 1–3 user-confirmed historical DSH participants |
| `review_jev_filtered` | Explicit Jev false-negative audit |
| `fetch_session` | Inclusive persisted source turns |
| `get_memory_stats` | DSH main sessions/events/turns after synchronization |
| `backfill_memory` | Explicit full DSH index rebuild; source logs unchanged |

Reads require exact persisted IDs and both inclusive indices, at most 20 indices. `max_chars` is 100–24000 and defaults to 12000. Reads do not resume or modify sessions. Discussion requires the saved Plugin Manager switch. Backfill is only for explicit DSH backfill or rescan requests. It does not import another harness's history. Statistics and backfill accept empty objects.

Every tool result appends a separate two-line invocation-time snapshot such as:

```text
Config · Discussion=off · Jev=off (nimble; disabled) · Obsidian=off · manageOllama=off · limit=20
Env · DSH_HOME=unset · API key=local-placeholder
```

The snapshot is visible both in the Web tool card and to the Agent because it is tool-result text. It reports switches, Jev model/runtime state, limit, and only `set`/`unset` for `DSH_HOME` and a configured API-key environment variable. It never exposes credential, vault, database, endpoint, or filesystem values.

## Local / remote Jev

Default off: `nimble`, `http://127.0.0.1:11434`, `manageOllama: false`. Viewing configuration or saving it does not start models or export notes.

```yaml
discussion:
  enabled: false
recall:
  limit: 20
jev:
  enabled: true
  model: your-system-one-model
  baseURL: https://your-decision-api.example
  apiKeyEnv: DSH_JEV_API_KEY
  contextWindow: 8192
  manageOllama: false
obsidian:
  enabled: false
```

Secret stays in **Host environment**, not browser/config. HTTP(S) roots allow deployment prefixes; SDK appends `/v1/systemone`. Embedded credentials, query/hash and redirects are rejected. Remote mode sends the complete question and candidate **DSH source text**; confirm data permission first. Configuring a URL does not prove System One/model/noul compatibility. Real-model/remote deployment tests are separate from HTTP fixtures.

Enabled unmanaged mode requires contextWindow 1024–1048576; remote also requires `apiKeyEnv`. Local unmanaged compatibility may use SDK key `ollama`. Managed Ollama requires a local HTTP loopback root and explicit start/pull permission; only owned children are cancelled/awaited, never a pre-existing service.

Actual Pi-style filtering uses escaped-JSON UTF-8 budgeted segments and batches <=64 questions, `max(segment noul) >= 0.5`, ranked order preserved/no refill. **Not single-request-per-turn/nonbatch.** Model failure is explicitly `unavailable` with literal results, no filtered-out judgment/retry until reconfigure/reload. Missing credentials/configuration errors/caller cancellation throw.

## Configuration and Obsidian

```text
Plugin Manager → DSH Session Memory row → Configure
├─ Multi-agent Discussion: enabled
├─ Recall: limit
├─ Jev: enabled / model / baseURL / apiKeyEnv / manageOllama / contextWindow
├─ Obsidian: enabled / vaultPath
└─ Save / Discard edits / Stage inherited defaults
```

Ten fields. Discussion defaults off. Edits/reset are staged; Save validates/revision-fences before transport. Blank optional values inherit. Refused saves preserve drafts, no stale overwrite. Save applies the Discussion switch live. Disabling it cancels active Discussion work. Save also cancels/drains old model/export work without remounting tools and does not synchronize history, start a model, or write a note. Actual plugin-row slot/browser artifact supplies GUI; Host Config alone is not GUI.

Obsidian default off, existing absolute Host vault only, no folder creation. Each completed recall/audit creates a unique `wx`/`0600` Markdown with bounded result/exact coordinates. Failure/cancellation removes its own partial file. No automatic wikilinks, ontology, AGENTS/rules/skills generation or vault sync. External sync may distribute private DSH history.

## Development / verification

Inspected host **DSH 0.2.1-rc.5**, Node >=22 (SQLite experimental in Node 22). React external; no install-time build hook.

```sh
npm ci
npm run test:all
DSH_CHECKOUT="$(npm root -g)/@deepseek-ai/dsh" npm run test:native
DSH_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
npm pack --dry-run --json --cache "$PWD/.npm-cache"
git diff --check
```

Use **`@shengxiao04/dsh-session-memory`**, not another project's unscoped package. Linked source changes do not reload a running profile. Actual GUI profile persistence/authorization, remote credentials/models and installation/restart remain separate from isolated tests. See [verification](docs/verification.md) and [scope/logic alignment](docs/parity.md).

Earlier 0.1.5: real bilingual staged plugin-row configuration/live replacement; 0.1.4: local snippet Jev/Obsidian, Host schema only; 0.1.3: rc.3 pin; 0.1.2: native event baseline. Existing `.archify` diagrams depict **0.1.5**, not this turn-index architecture.
