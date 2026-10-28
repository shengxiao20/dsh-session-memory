# Verification — dsh-session-memory 0.1.3

## Environment

- Node v22.22.2; inspected DSH 0.2.1-rc.3.
- Independent local fork on `dsh-only`; upstream remote retains the original repository.
- Active-profile installation uses the supported Plugin Manager, not handwritten profile files.

## rc.3 compatibility upgrade

- Reviewed the installed rc.3 `sessionQuery`, `tools`, and `commands` declarations and exercised the unchanged adapter against their real implementations.
- Bundle version is now `0.1.3`; `engines.dsh` pins `0.2.1-rc.3`. No search/read logic, backend patch, or active-profile config was changed.
- `npm run test:all`: syntax checks and **24/24** unit tests passed after the upgrade.
- `DSH_CHECKOUT="$(npm root -g)/@deepseek-ai/dsh" npm run test:native`: passed on installed rc.3, including real tool registration/execution, global/exact-CWD/event search, forks, subagent exclusion, pagination, bounded reads, stale cursors and token semantics. SQLite emitted its standard experimental warning.
- `npm pack --dry-run --cache "$PWD/.npm-cache"`: passed for `0.1.3`, with 15 packaged files. `git diff --check` passed.
- The profile installation and live-history results below describe the previous `0.1.2` installation on rc.2. They do not establish that `0.1.3` is published, installed, or live-tested in the active profile.

## Previous 0.1.2 checks (rc.2)

1. `npm run test:all`: JavaScript syntax checks and **24/24** zero-dependency Node tests passed. Covers native request shape, explicit scope, cursors, authoritative-header subagent exclusion, main-session fork retention, observation disposal, validation/cancellation, bounded Unicode text, target-first budgets, safe omission notices, schemas, and shared tool/command lifecycles.
2. `DSH_CHECKOUT=... npm run test:native`: passed against actual installed Cordis, session, SQLite FTS5, systemPrompt, tools and commands services, with a fresh isolated context and an in-memory index. Real plugin registration and real `ctx.tools.execute` output/schema/rendering validation passed. Fixture checks cover global search, exact CWD, event search, root forks, subagent exclusion, native pagination, bounded reads, stale-cursor rejection and token—not substring—semantics. No active profile/history is read or modified by this script.
3. Package dry-run checked the runtime, YAML patch, localized display metadata, icon and documentation. The default npm cache initially failed with filesystem `EPERM`; validation uses an explicitly writable workspace `.npm-cache` instead, without changing global cache ownership or permissions.
4. Profile installation: `0.1.2` is confirmed installed and enabled in Plugin Manager, with the `session-query-sqlite` override. The last install result was interrupted, so it was not retried blindly; installed state and actual live behavior were verified afterward. Approval-free Config inspection resolves `include:dsh-session-memory` to the installed package directory. `status: absent` means this plugin intentionally exports no Config schema; it is not an activation error.
5. **Live history smoke passed**: `recall_memory` with query `pi-session-memory`, null optional scope/cursor fields and limit 3 returned one eligible match, excluded two subagent sessions and supplied a continuation cursor. `fetch_session` then successfully read the first actual hit with one event before/after and a 1000-character budget: three events returned, no text-truncation marker. Private historical excerpts are not copied into this record. This validates the installed retrieval/read path against actual DSH main-session history; it is not an independent persistence-backend test or a browser visual test.

## Defects caught and repaired before delivery

- The online profile initially had `path: ':memory:'`, `openAt: never`, so registration succeeded but actual recall was disabled. Composed config was inspected; the bundle now overrides that same shipped row/path to `openAt: first-search`, without another backend or session-log writes. This is intentionally an enabling override, removable with the bundle.
- The delegated agent's strict function interface required optional fields to be present. Optional tool parameters now accept null as omission; mandatory fields remain non-nullable. A dedicated test and real tool-registry execution cover the fix.

- Fake-service tests initially accepted the wrong `filters` key for global search. The real FTS backend expects `sessionFilters`; the implementation and regression assertions now require it. Within-session `searchEvents` correctly has its own `filters` contract.
- Real tool registration requires `type` on a constant schema node. Both output `source` fields now use `{ type: 'string', const: 'dsh' }`; real tool-registry validation passes. The initially failed profile installation was removed and reinstalled through Plugin Manager, then applied successfully.
- Session fixtures must include message IDs to remain valid through forks; the native smoke fixtures now include them.

## Model-context measurement

Using compact name+description+parameters JSON, the original project exposes 6 tool schemas / **3460 UTF-16 characters**, versus 2 schemas / **2422 characters** here: **30.00% smaller**. A transparent characters÷4 estimate is ~865 versus ~606 tokens. Including the original's 909-character prompt snippet yields ~1093 versus ~606 estimated tokens, **44.56% smaller**. These are estimates, not tokenizer measurements; provider wrappers and output-schema transport overhead are excluded. This bundle adds no standing system-prompt section. The final count includes nullable optional parameters required for compatibility with strict function-calling interfaces.

## Boundaries

- Rendering of Plugin Manager titles/icons and slash-command UI in the connected browser is not visually verified; installation does not establish visual success. Exported resources are validated separately.
- Native fixture integration covers live sessions, not persisted-file repair or every DSH event type. Persisted history remains the native query backend's responsibility.
- Only DSH 0.2.1-rc.3 is declared compatible. Other DSH versions require contract review and tests, not a silent version exemption.
- npm package identity is `@shengxiao04/dsh-session-memory`; the unscoped npm name belongs to an unrelated publisher. No remote GitHub fork was created. The original project's uncommitted files were not copied, and its working-tree changes are left untouched. This document records implementation and pre-publication verification; registry publication is checked separately.
