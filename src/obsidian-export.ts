import { randomUUID } from "node:crypto";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ObsidianExportResult { vaultPath: string; file: string; }

/** Write one complete search result document as a new Markdown note in an existing Obsidian vault. */
export function exportSearchResultsToObsidian(vaultPath: string, title: string, content: string): ObsidianExportResult {
  const resolvedVaultPath = resolve(vaultPath);
  if (!existsSync(resolvedVaultPath)) throw new Error(`Obsidian vault does not exist: ${resolvedVaultPath}`);
  if (!statSync(resolvedVaultPath).isDirectory()) throw new Error(`Obsidian vault is not a directory: ${resolvedVaultPath}`);
  const createdAt = new Date();
  const file = resolve(resolvedVaultPath, `pi-session-memory-search-${createdAt.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.md`);
  writeFileSync(file, [
    "---",
    `created_at: ${JSON.stringify(createdAt.toISOString())}`,
    `title: ${JSON.stringify(title)}`,
    "source: pi-session-memory",
    "---",
    "",
    `# ${title}`,
    "",
    content,
    "",
  ].join("\n"), { encoding: "utf8", flag: "wx" });
  return { vaultPath: resolvedVaultPath, file };
}
