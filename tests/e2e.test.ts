import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbPath = join(tmpdir(), `pi-session-memory-e2e-${process.pid}.db`);
const historyHome = join(tmpdir(), `pi-session-memory-e2e-home-${process.pid}`);
process.env.MEMORY_DB_PATH = dbPath;
process.env.HOME = historyHome;
process.env.USERPROFILE = historyHome; // isolate Windows home too.

function cleanup(): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  rmSync(historyHome, { recursive: true, force: true });
}
cleanup();
const obsidianVault = join(historyHome, "obsidian-vault");
mkdirSync(join(historyHome, ".pi", "agent", "pi-session-memory"), { recursive: true });
mkdirSync(obsidianVault, { recursive: true });
writeFileSync(join(historyHome, ".pi", "agent", "pi-session-memory", "config.json"), JSON.stringify({ recallLimit: 2, obsidianExportEnabled: true, obsidianVaultPath: obsidianVault }));

const extension = (await import("../extensions/index.ts")).default;
const events: Array<{ event: string; handler: (...args: any[]) => unknown }> = [];
const commands: Array<{ name: string; options: { description: string; handler: (args: string, ctx: unknown) => Promise<void> } }> = [];
const tools: Array<{ name: string; description: string; parameters: unknown; execute: (...args: any[]) => Promise<{ content: Array<{ type: string; text: string }> }> }> = [];

extension({
  on(event: string, handler: (...args: any[]) => unknown) { events.push({ event, handler }); },
  registerCommand(name: string, options: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) { commands.push({ name, options }); },
  registerTool(tool: { name: string; description: string; parameters: unknown; execute: (...args: any[]) => Promise<{ content: Array<{ type: string; text: string }> }> }) { tools.push(tool); },
} as any);

assert.deepEqual(events.map(({ event }) => event), ["session_start", "agent_settled", "session_shutdown"]);
assert.equal(commands.length, 1);
assert.deepEqual(commands.map(({ name }) => name), ["pi-session-memory"]);
assert.equal(tools.length, 7);
assert.ok(commands.every(({ options }) => options.description.length > 0), "every user command needs a description");
assert.ok(tools.every((tool) => tool.description.length > 0), "every agent tool needs a description");

const notices: Array<{ message: string; level: string }> = [];
const selections: string[] = ["Help — explain history search, indexing, and migration", `What's new — pi-session-memory v${(await import("../package.json", { with: { type: "json" } })).default.version}`];
const ctx = { ui: {
  notify(message: string, level: string) { notices.push({ message, level }); },
  async select(_title: string, _options: string[]) { return selections.shift(); },
  async input() { return undefined; },
} };
const menu = commands.find((command) => command.name === "pi-session-memory");
assert.ok(menu);
await menu.options.handler("", ctx);
assert.match(notices[0]?.message ?? "", /pi-session-memory/);
await menu.options.handler("", ctx);
assert.match(notices[1]?.message ?? "", /What's New in pi-session-memory v0\.7\.16/);
assert.match(notices[1]?.message ?? "", /pi-extension/);

const migration = tools.find((tool) => tool.name === "migrate_project_sessions");
assert.ok(migration);
assert.match(migration.description, /Claude Code and Codex/);
assert.equal(tools.filter((tool) => /^migrate_(claude|codex)_project_sessions$/.test(tool.name)).length, 0);

const stats = tools.find((tool) => tool.name === "get_memory_stats");
assert.ok(stats);
const result = await stats.execute();
assert.match(result.content[0]?.text ?? "", /0 turns across 0 sessions/);

const recall = tools.find((tool) => tool.name === "recall_memory");
assert.ok(recall);
assert.match(recall.description, /Always call recall_project_memory too with identical entities and question/);
const recallParameters = JSON.stringify(recall.parameters);
for (const forbiddenScope of ["cwd", "project", "sources", "sessionIds", "after", "before"]) {
  assert.doesNotMatch(recallParameters, new RegExp(`"${forbiddenScope}"`), `global recall must not expose ${forbiddenScope} scoping`);
}
const recallResult = await recall.execute("call", { entities: ["jev", "filter"], question: "Was jev filtering implemented?" }, undefined, () => {});
const recallText = recallResult.content[0]?.text ?? "";
assert.ok(recallText.startsWith("# Recall results"), "disabled Jev must not add a visible summary");
assert.doesNotMatch(recallText, /# Jev result|jevEnable is false|\*\*Model:\*\* nimble/);
const exportedNotes = readdirSync(obsidianVault);
assert.equal(exportedNotes.length, 1, "every completed recall tool search must export one complete note when enabled");
assert.match(readFileSync(join(obsidianVault, exportedNotes[0]!), "utf8"), /# Recall search/);

const projectRecall = tools.find((tool) => tool.name === "recall_project_memory");
assert.ok(projectRecall);
assert.match(projectRecall.description, /Always call this tool together with recall_memory for every prior-conversation/);
assert.match(projectRecall.description, /No project argument exists/);
const projectRecallParameters = JSON.stringify(projectRecall.parameters);
for (const forbiddenScope of ["cwd", "project", "sources", "sessionIds", "after", "before"]) {
  assert.doesNotMatch(projectRecallParameters, new RegExp(`"${forbiddenScope}"`), `project recall must not expose ${forbiddenScope} scoping`);
}

const reviewFiltered = tools.find((tool) => tool.name === "review_jev_filtered");
assert.ok(reviewFiltered);
assert.match(reviewFiltered.description, /global and entity-discovered project-session literal recall/);
assert.doesNotMatch(JSON.stringify(reviewFiltered.parameters), /"cwd"|"sources"|"sessionIds"|"after"|"before"/, "Jev review must not expose extra scoping");

(await import("../src/db.ts")).getDb().close();
cleanup();
console.log("e2e.test.ts: passed");
