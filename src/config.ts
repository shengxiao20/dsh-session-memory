import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const JEV_MODELS = ["nimble", "tev1:4b", "tev1:0.8b"] as const;
export type JevModel = typeof JEV_MODELS[number];

export interface SessionMemoryConfig {
  recallLimit: number;
  /** Optional relevance filtering through local Jev; omitted legacy configuration means false. */
  jevEnable: boolean;
  /** Ollama decision model used by Jev; omitted legacy configuration means nimble. */
  model: JevModel;
  /** Automatically export every completed search to Obsidian; omitted configuration means false. */
  obsidianExportEnabled: boolean;
  /** Existing Obsidian vault directory required only when automatic export is enabled. */
  obsidianVaultPath?: string;
}

/** Read global extension configuration; missing jevEnable is deliberately backward-compatible as false. */
export function getSessionMemoryConfig(): SessionMemoryConfig {
  const path = join(homedir(), ".pi", "agent", "pi-session-memory", "config.json");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!_isConfig(value)) throw new Error(`Invalid pi-session-memory configuration at ${path}: recallLimit must be a positive integer; jevEnable and obsidianExportEnabled must be booleans when provided; model must be one of ${JEV_MODELS.join(", ")} when provided; obsidianVaultPath must be a non-empty string when obsidianExportEnabled is true.`);
  return { recallLimit: value.recallLimit, jevEnable: value.jevEnable ?? false, model: value.model ?? "nimble", obsidianExportEnabled: value.obsidianExportEnabled ?? false, obsidianVaultPath: value.obsidianVaultPath };
}

/** Read the required global recall result limit from Pi's extension configuration directory. */
export function getRecallLimit(): number { return getSessionMemoryConfig().recallLimit; }

function _isConfig(value: unknown): value is { recallLimit: number; jevEnable?: boolean; model?: JevModel; obsidianExportEnabled?: boolean; obsidianVaultPath?: string } {
  return typeof value === "object" && value !== null
    && typeof (value as { recallLimit?: unknown }).recallLimit === "number"
    && Number.isInteger((value as { recallLimit: number }).recallLimit)
    && (value as { recallLimit: number }).recallLimit >= 1
    && ((value as { jevEnable?: unknown }).jevEnable === undefined || typeof (value as { jevEnable?: unknown }).jevEnable === "boolean")
    && ((value as { model?: unknown }).model === undefined || JEV_MODELS.includes((value as { model: JevModel }).model))
    && ((value as { obsidianExportEnabled?: unknown }).obsidianExportEnabled === undefined || typeof (value as { obsidianExportEnabled?: unknown }).obsidianExportEnabled === "boolean")
    && ((value as { obsidianVaultPath?: unknown }).obsidianVaultPath === undefined || (typeof (value as { obsidianVaultPath: unknown }).obsidianVaultPath === "string" && (value as { obsidianVaultPath: string }).obsidianVaultPath.trim().length > 0))
    && ((value as { obsidianExportEnabled?: boolean }).obsidianExportEnabled !== true || (typeof (value as { obsidianVaultPath?: unknown }).obsidianVaultPath === "string" && (value as { obsidianVaultPath: string }).obsidianVaultPath.trim().length > 0));
}
