import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".pi", "agent", "pi-session-memory", "whats-new.json");

const RELEASE_NOTES: Record<string, string> = {
  "0.7.12": `What's New in pi-session-memory v0.7.12

- recall_memory now has one responsibility: global literal search of transcript content.
- recall_project_memory now has one distinct responsibility: discover only user-named projects by stored session CWD directory name, even when the project name is absent from transcript text.
- Named-project discovery is not inferred from the current CWD, is not automatically paired with global recall, and uses independent content entities.`,

  "0.7.11": `What's New in pi-session-memory v0.7.11

- recall_project_memory no longer accepts source or time filters and always searches every turn in all sessions resolved from project.
- Its public parameters are now limited to project, literal topic entities, and the complete question.`,

  "0.7.10": `What's New in pi-session-memory v0.7.10

- recall_memory now always searches every indexed SQLite turn and exposes no CWD, project, source, session, or time scope.
- Its public parameters are limited to literal topic entities and the complete question, preventing accidental narrowing of global recall.`,

  "0.7.9": `What's New in pi-session-memory v0.7.9

- When jevEnable is false, global and project recall now show only recall results without a redundant disabled Jev status section.
- Jev diagnostics remain visible when filtering is enabled, unavailable, or fails.`,

  "0.7.8": `What's New in pi-session-memory v0.7.8

- recall_memory is now guaranteed to search globally across every indexed project and no longer exposes a CWD parameter.
- Project-specific retrieval remains exclusively in recall_project_memory, which should be called alongside global recall when project context is relevant.
- Global review_jev_filtered audits can no longer be accidentally restricted by the current CWD.`,

  "0.7.7": `What's New in pi-session-memory v0.7.7

- Obsidian configuration is fully optional: omit obsidianExportEnabled and obsidianVaultPath to keep export disabled by default.
- Configure obsidianVaultPath only when explicitly enabling export with obsidianExportEnabled: true.`,

  "0.7.6": `What's New in pi-session-memory v0.7.6

- When obsidianExportEnabled is true, every completed history search automatically writes its complete result to one new Markdown note in obsidianVaultPath.
- No result selection is required, and Obsidian export is not registered as an agent tool or added to agent context.`,

  "0.7.5": `What's New in pi-session-memory v0.7.5

- Configuration-controlled Obsidian export: set obsidianExportEnabled and obsidianVaultPath, then explicitly select displayed search results from the menu.
- Obsidian export is not registered as an agent tool and is not added to agent context.`,

  "0.7.4": `What's New in pi-session-memory v0.7.4

- Explicitly export selected recalled turns to new Markdown notes in an existing Obsidian vault from the search menu.
- Exports require exact source turn IDs, never run automatically, and refuse to overwrite an existing note.`,

  "0.7.3": `What's New in pi-session-memory v0.7.3

- Startup history synchronization remains enabled, but the automatic sync summary is no longer displayed when a Pi session starts.
- Synchronization errors and Jev availability status notifications remain visible.`,

  "0.7.2": `What's New in pi-session-memory v0.7.2

- Codex history import now supports optional and repeated message IDs and keeps parent and child threads separate.
- Native-session migration shares the same deterministic message identity rules without deduplicating repeated text.
- Existing Codex index entries are reparsed once after the parser upgrade, with transactional replacement and conflict rollback.
- The npm package version is now 0.7.2.`,

  "0.7.0": `What's New in pi-session-memory v0.7.0

- One command only: use the /pi-session-memory folded menu for help, release notes, storage status, global/project recall, history import, and session migration. Former standalone slash commands are removed.
- Optional Jev filtering reviews already-ranked literal results locally and filters keyword-only false positives; review or setup failures keep literal recall active.
- Expanded agent tools include project-scoped recall, unified Claude Code/Codex migration, and review_jev_filtered for auditing filtered evidence.
- The global JSON configuration path and supported fields are documented in the Help menu and README.
- The npm package version is now 0.7.0.`,

  "0.6.2": `What's New in pi-session-memory v0.6.2

- Named-project recall now matches normalized project words against session CWD directory names alongside direct recall whenever project context is relevant.
- Use the same Chinese and English topic entities in both searches; project names remain metadata, not transcript search terms.
- Project topic search covers every matching session before recallLimit caps ranked turns; with no topic match, recallLimit caps recent session candidates.`,
};

interface WhatsNewState { shownVersion: string; }

/** Return the maintained release notes for a package version, or an empty string when none are published. */
export function getWhatsNew(version: string): string {
  return RELEASE_NOTES[version] ?? "";
}

/** Return unshown release notes once and persist the displayed package version globally. */
export function showWhatsNewIfUpdated(version: string): string | undefined {
  const state = _readState();
  if (state?.shownVersion === version) return undefined;
  _writeState({ shownVersion: version });
  return getWhatsNew(version);
}

function _readState(): WhatsNewState | undefined {
  if (!existsSync(STATE_PATH)) return undefined;
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as WhatsNewState;
}

function _writeState(state: WhatsNewState): void {
  mkdirSync(join(homedir(), ".pi", "agent", "pi-session-memory"), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state)}\n`, "utf8");
}
