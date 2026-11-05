window.__ModuleLoader__.load({ id: "@shengxiao04/dsh-session-memory", factory: (require) => {
const module = { exports: {} }; const exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// client/config-page.js
var import_react = require("react");

// src/config-values.js
function object(value, label, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} parameter: ${key}`);
}
function apiRoot(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Jev baseURL must be an HTTP(S) API root.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Jev baseURL must be an HTTP(S) API root without credentials, query or hash.");
  }
  return url.href.replace(/\/+$/u, "");
}
function localRoot(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Jev baseURL must be a local HTTP loopback root.");
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Jev baseURL must be a local HTTP loopback root without credentials, path, query or hash; remote Jev is prohibited.");
  }
  return url.origin;
}
function validateConfig(input, isAbsolute) {
  object(input, "config", ["jev", "obsidian", "recall"]);
  if (Object.hasOwn(input, "recall")) object(input.recall, "recall", ["limit"]);
  const recall = { limit: 20, ...input.recall };
  if (!Number.isSafeInteger(recall.limit) || recall.limit < 1 || recall.limit > 50) throw new Error("Recall limit must be an integer between 1 and 50.");
  if (Object.hasOwn(input, "jev")) object(input.jev, "jev", ["enabled", "model", "baseURL", "apiKeyEnv", "manageOllama", "contextWindow"]);
  if (Object.hasOwn(input, "obsidian")) object(input.obsidian, "obsidian", ["enabled", "vaultPath"]);
  const jev = { enabled: false, model: "nimble", baseURL: "http://127.0.0.1:11434", manageOllama: false, ...input.jev };
  const obsidian = { enabled: false, ...input.obsidian };
  for (const [label, value] of [["jev.enabled", jev.enabled], ["jev.manageOllama", jev.manageOllama], ["obsidian.enabled", obsidian.enabled]]) {
    if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  }
  if (typeof jev.model !== "string" || !jev.model.trim() || jev.model.length > 200) throw new Error("Jev model must be nonempty text of at most 200 characters.");
  jev.model = jev.model.trim();
  jev.baseURL = apiRoot(jev.baseURL);
  const url = new URL(jev.baseURL);
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.pathname === "/";
  if (jev.manageOllama) localRoot(jev.baseURL);
  if (jev.apiKeyEnv !== void 0 && (typeof jev.apiKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,199}$/u.test(jev.apiKeyEnv))) throw new Error("Jev apiKeyEnv must be an environment-variable name, not an API key.");
  if (jev.enabled && !local && jev.apiKeyEnv === void 0) throw new Error("Enabled remote Jev requires apiKeyEnv: the Host environment variable containing its API key.");
  if (jev.contextWindow !== void 0 && (!Number.isSafeInteger(jev.contextWindow) || jev.contextWindow < 1024 || jev.contextWindow > 1048576)) {
    throw new Error("Jev contextWindow must be an integer between 1024 and 1048576.");
  }
  if (jev.enabled && !jev.manageOllama && jev.contextWindow === void 0) throw new Error("Enabled unmanaged Jev requires an explicit contextWindow.");
  if (obsidian.vaultPath !== void 0 && (typeof obsidian.vaultPath !== "string" || !isAbsolute(obsidian.vaultPath) || obsidian.vaultPath.length > 4e3)) {
    throw new Error("Obsidian vaultPath must be an absolute path of at most 4000 characters.");
  }
  if (obsidian.enabled && obsidian.vaultPath === void 0) throw new Error("Enabled Obsidian export requires an existing absolute vaultPath.");
  return Object.freeze({ recall: Object.freeze(recall), jev: Object.freeze(jev), obsidian: Object.freeze(obsidian) });
}

// client/config-editor.js
var FIELDS = [
  { key: "recall.limit", type: "number", min: 1, max: 50 },
  { key: "jev.enabled", type: "checkbox" },
  { key: "jev.model", type: "text" },
  { key: "jev.baseURL", type: "text" },
  { key: "jev.apiKeyEnv", type: "text", optional: true },
  { key: "jev.manageOllama", type: "checkbox" },
  { key: "jev.contextWindow", type: "number", optional: true, min: 1024, max: 1048576 },
  { key: "obsidian.enabled", type: "checkbox" },
  { key: "obsidian.vaultPath", type: "text", optional: true }
];
function fieldValue(value, key) {
  return key.split(".").reduce((node, part) => node?.[part], value);
}
function createDraft(state) {
  return { value: structuredClone(state.value), base: structuredClone(state.base), revision: state.revision, ops: [] };
}
function editDraft(draft, field, input) {
  const path = field.key.split(".");
  const value = field.type === "number" && input !== "" ? Number(input) : input;
  const op = field.optional && input === "" ? { op: "unset", path } : { op: "set", path, value };
  return { ...draft, ops: [...draft.ops.filter((item) => item.path.join(".") !== field.key), op] };
}
function resetDraft(draft) {
  return { ...draft, ops: [{ op: "unset", path: ["recall"] }, { op: "unset", path: ["jev"] }, { op: "unset", path: ["obsidian"] }] };
}
function draftValue(draft) {
  const value = structuredClone(draft.value);
  for (const op of draft.ops) {
    const [group, field] = op.path;
    const inherited = op.path.reduce((node, part) => node?.[part], draft.base);
    if (field === void 0) value[group] = structuredClone(inherited);
    else {
      if (op.op === "set") value[group][field] = op.value;
      else if (inherited === void 0) delete value[group][field];
      else value[group][field] = inherited;
    }
  }
  return value;
}
function validateDraft(draft) {
  return validateConfig(draftValue(draft), (path) => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path));
}
async function saveDraft(form, draft) {
  if (form.state.status !== "ready" || !form.state.writable) throw new Error("Configuration is unavailable or read-only.");
  if (!Number.isSafeInteger(draft.revision)) throw new Error("No accepted configuration revision.");
  validateDraft(draft);
  return form.mutate(draft.ops, draft.revision);
}

// client/config-page.js
var panel = { display: "grid", gap: "14px", color: "var(--dsw-alias-label-primary, inherit)", maxWidth: "680px" };
var inputStyle = { width: "100%", boxSizing: "border-box", padding: "8px", border: "1px solid var(--dsw-alias-border-primary, #888)", borderRadius: "6px", color: "inherit", background: "var(--dsw-alias-background-primary, transparent)" };
function Editor({ form, t }) {
  const [draft, setDraft] = (0, import_react.useState)(() => createDraft(form.state));
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [message, setMessage] = (0, import_react.useState)("");
  const value = draftValue(draft);
  const disabled = !form.state.writable || saving;
  (0, import_react.useEffect)(() => {
    if (!saving && draft.ops.length === 0 && draft.revision !== form.state.revision) setDraft(createDraft(form.state));
  }, [form.state, draft, saving]);
  async function save(event) {
    event.preventDefault();
    setMessage("");
    setSaving(true);
    try {
      const accepted = await saveDraft(form, draft);
      if (accepted) {
        setDraft((current) => ({ ...current, value: draftValue(current), ops: [] }));
        setMessage(t("saved"));
      } else setMessage(t("refused"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  return (0, import_react.createElement)(
    "form",
    { onSubmit: save, style: panel, "aria-label": t("title") },
    (0, import_react.createElement)("p", null, t("intro")),
    !form.state.writable && (0, import_react.createElement)("p", { role: "status" }, t("readOnly")),
    ...["recall", "jev", "obsidian"].map((group) => (0, import_react.createElement)(
      "fieldset",
      { key: group, disabled, style: panel },
      (0, import_react.createElement)("legend", null, t(group)),
      ...FIELDS.filter((field) => field.key.startsWith(`${group}.`)).map((field) => (0, import_react.createElement)(
        "label",
        { key: field.key, style: { display: "grid", gap: "6px" } },
        (0, import_react.createElement)("span", null, t(field.key)),
        (0, import_react.createElement)("input", {
          type: field.type,
          name: field.key,
          style: field.type === "checkbox" ? void 0 : inputStyle,
          ...field.type === "checkbox" ? { checked: fieldValue(value, field.key) } : { value: fieldValue(value, field.key) ?? "" },
          ...field.type === "number" ? { min: field.min, max: field.max, step: 1 } : {},
          onChange: (event) => setDraft((current) => editDraft(current, field, field.type === "checkbox" ? event.target.checked : event.target.value))
        }),
        (0, import_react.createElement)("small", null, t(`${field.key}.hint`))
      ))
    )),
    (0, import_react.createElement)(
      "div",
      { style: { display: "flex", gap: "12px" } },
      (0, import_react.createElement)("button", { type: "submit", disabled: disabled || draft.ops.length === 0 }, t(saving ? "saving" : "save")),
      (0, import_react.createElement)("button", { type: "button", disabled, onClick: () => {
        setDraft(createDraft(form.state));
        setMessage("");
      } }, t("discard")),
      (0, import_react.createElement)("button", { type: "button", disabled, onClick: () => {
        setDraft((current) => resetDraft(current));
        setMessage("");
      } }, t("reset"))
    ),
    message && (0, import_react.createElement)("p", { role: "status", style: { overflowWrap: "anywhere" } }, message)
  );
}
function ConfigPage({ view, form, t }) {
  if (view === "summary") return t("summary");
  if (!form || form.state.status !== "ready") return (0, import_react.createElement)("p", { role: "status" }, t("unavailable"));
  return (0, import_react.createElement)(Editor, { form, t });
}

// locale/en.json
var en_default = {
  meta: {
    title: "DSH Session Memory",
    description: "DSH-only persisted source-turn recall: plugin-owned SQLite, entity ranking/global-project dedup, local/remote Jev, history reads/stats/backfill and Obsidian."
  },
  config: {
    title: "DSH Session Memory configuration",
    summary: "Recall defaults, local/remote Jev and Obsidian export settings.",
    intro: "Changes are staged until Save. Saving applies live and cancels outstanding memory work; it does not start a model or write a note.",
    recall: "Recall defaults",
    "recall.limit": "Top K per stage",
    "recall.limit.hint": "Integer 1\u201350, default 20. Filters/dedup never refill. Call arguments can set a different limit.",
    jev: "Jev connection",
    obsidian: "Obsidian export",
    "jev.enabled": "Enable Jev",
    "jev.enabled.hint": "Default off. Recall judges complete visible source turns before output truncation; model failures are explicitly unavailable and configuration errors throw.",
    "jev.model": "Model",
    "jev.model.hint": "Explicit local or remote System One model, default nimble.",
    "jev.baseURL": "API root",
    "jev.baseURL.hint": "HTTP(S) API root, without embedded credentials, query, hash or redirects. Remote connections send the question and selected source-turn text to this server.",
    "jev.apiKeyEnv": "API key environment variable",
    "jev.apiKeyEnv.hint": "Host variable name, never the secret itself. Required for remote Jev; must be populated on the Host. Blank restores inheritance.",
    "jev.manageOllama": "Manage Ollama",
    "jev.manageOllama.hint": "Explicit permission to start local Ollama and pull this model. Never shuts down a pre-existing service.",
    "jev.contextWindow": "Context window",
    "jev.contextWindow.hint": "Integer 1024\u20131048576. Required for enabled unmanaged Jev; optional cap when managed. Blank restores inherited value.",
    "obsidian.enabled": "Enable automatic notes",
    "obsidian.enabled.hint": "Every completed recall/audit page creates a private Markdown note. External vault sync may distribute history.",
    "obsidian.vaultPath": "Vault directory",
    "obsidian.vaultPath.hint": "Existing absolute Host directory, required when enabled. No folders are created. Blank restores inherited value.",
    save: "Save",
    saving: "Saving\u2026",
    saved: "Saved; configuration applied.",
    refused: "Save refused or configuration changed elsewhere. Draft kept; discard to read current values before retrying.",
    discard: "Discard edits",
    reset: "Stage inherited defaults",
    readOnly: "Configuration is read-only in this deployment.",
    unavailable: "Configuration is not available. Enable the plugin and reload the profile/browser if needed."
  }
};

// locale/zh.json
var zh_default = {
  meta: {
    title: "DSH \u4F1A\u8BDD\u8BB0\u5FC6",
    description: "\u4EC5\u6301\u4E45\u5316 DSH \u6E90 turn \u53EC\u56DE\u3001\u63D2\u4EF6\u81EA\u6709 SQLite\u3001\u5B9E\u4F53\u6392\u5E8F\u53CA\u5168\u5C40\u9879\u76EE\u53BB\u91CD\u3001\u672C\u5730\uFF0F\u8FDC\u7A0B Jev\u3001\u5386\u53F2\u8BFB\u53D6\uFF0F\u7EDF\u8BA1\uFF0F\u91CD\u5EFA\u548C Obsidian\u3002"
  },
  config: {
    title: "DSH Session Memory \u53C2\u6570\u914D\u7F6E",
    summary: "\u53EC\u56DE\u9ED8\u8BA4\u503C\u3001\u672C\u5730\uFF0F\u8FDC\u7A0B Jev \u548C Obsidian \u5BFC\u51FA\u8BBE\u7F6E\u3002",
    intro: "\u53C2\u6570\u5148\u6682\u5B58\uFF0C\u70B9\u51FB\u4FDD\u5B58\u624D\u63D0\u4EA4\u3002\u4FDD\u5B58\u7ACB\u5373\u5E94\u7528\u5E76\u53D6\u6D88\u6B63\u5728\u6267\u884C\u7684\u8BB0\u5FC6\u67E5\u8BE2\uFF0C\u4E0D\u542F\u52A8\u6A21\u578B\u6216\u5199\u7B14\u8BB0\u3002",
    recall: "\u53EC\u56DE\u9ED8\u8BA4\u503C",
    "recall.limit": "\u6BCF\u9636\u6BB5 Top K",
    "recall.limit.hint": "1\u201350 \u6574\u6570\uFF0C\u9ED8\u8BA4 20\u3002\u7B5B\u9009\uFF0F\u53BB\u91CD\u4E0D\u8865\u9F50\uFF1B\u8C03\u7528\u53C2\u6570\u53EF\u6307\u5B9A\u4E0D\u540C limit\u3002",
    jev: "Jev \u8FDE\u63A5",
    obsidian: "Obsidian \u5BFC\u51FA",
    "jev.enabled": "\u542F\u7528 Jev",
    "jev.enabled.hint": "\u9ED8\u8BA4\u5173\u95ED\u3002\u53EC\u56DE\u4F7F\u7528\u8F93\u51FA\u622A\u65AD\u524D\u5B8C\u6574\u7684\u53EF\u89C1\u6E90 turn\uFF1B\u6A21\u578B\u6545\u969C\u660E\u786E\u6807\u8BB0 unavailable\uFF0C\u914D\u7F6E\u9519\u8BEF\u629B\u51FA\u3002",
    "jev.model": "\u6A21\u578B",
    "jev.model.hint": "\u663E\u5F0F\u672C\u5730\u6216\u8FDC\u7A0B System One \u6A21\u578B\uFF0C\u9ED8\u8BA4 nimble\u3002",
    "jev.baseURL": "API \u6839\u5730\u5740",
    "jev.baseURL.hint": "HTTP(S) \u6839\u5730\u5740\uFF0C\u4E0D\u5F97\u5185\u5D4C\u51ED\u636E\u3001query\u3001hash\uFF0C\u62D2\u7EDD\u91CD\u5B9A\u5411\u3002\u8FDC\u7A0B\u6A21\u5F0F\u4F1A\u5C06\u5B8C\u6574\u95EE\u9898\u53CA\u5019\u9009\u6E90 turn \u6587\u672C\u53D1\u7ED9\u8BE5\u670D\u52A1\u5668\u3002",
    "jev.apiKeyEnv": "API Key \u73AF\u5883\u53D8\u91CF\u540D",
    "jev.apiKeyEnv.hint": "\u586B\u5199 Host \u53D8\u91CF\u540D\uFF0C\u4E0D\u662F\u5BC6\u94A5\u672C\u8EAB\u3002\u8FDC\u7A0B Jev \u5FC5\u586B\u4E14\u987B\u5728 Host \u4E0A\u8BBE\u7F6E\uFF1B\u7559\u7A7A\u6062\u590D\u7EE7\u627F\u503C\u3002",
    "jev.manageOllama": "\u7BA1\u7406 Ollama",
    "jev.manageOllama.hint": "\u660E\u786E\u5141\u8BB8\u542F\u52A8\u672C\u5730 Ollama \u548C pull \u6A21\u578B\uFF1B\u4E0D\u5173\u95ED\u5DF2\u6709\u670D\u52A1\u3002",
    "jev.contextWindow": "\u4E0A\u4E0B\u6587\u7A97\u53E3",
    "jev.contextWindow.hint": "1024\u20131048576 \u6574\u6570\uFF1B\u542F\u7528\u975E\u6258\u7BA1 Jev \u5FC5\u586B\uFF0C\u6258\u7BA1\u6A21\u5F0F\u4E3A\u53EF\u9009\u4E0A\u9650\u3002\u7559\u7A7A\u6062\u590D\u7EE7\u627F\u503C\u3002",
    "obsidian.enabled": "\u542F\u7528\u81EA\u52A8\u7B14\u8BB0",
    "obsidian.enabled.hint": "\u6BCF\u4E2A\u5B8C\u6210\u7684\u53EC\u56DE\uFF0F\u5BA1\u8BA1\u9875\u751F\u6210\u79C1\u6709 Markdown\uFF1B\u5916\u90E8 vault \u540C\u6B65\u53EF\u80FD\u4F20\u64AD\u5386\u53F2\u5185\u5BB9\u3002",
    "obsidian.vaultPath": "Vault \u76EE\u5F55",
    "obsidian.vaultPath.hint": "Host \u4E0A\u5DF2\u5B58\u5728\u7684\u7EDD\u5BF9\u76EE\u5F55\uFF0C\u542F\u7528\u5BFC\u51FA\u65F6\u5FC5\u586B\uFF1B\u4E0D\u521B\u5EFA\u6587\u4EF6\u5939\u3002\u7559\u7A7A\u6062\u590D\u7EE7\u627F\u503C\u3002",
    save: "\u4FDD\u5B58",
    saving: "\u4FDD\u5B58\u4E2D\u2026",
    saved: "\u5DF2\u4FDD\u5B58\u5E76\u5E94\u7528\u914D\u7F6E\u3002",
    refused: "\u4FDD\u5B58\u88AB\u62D2\u7EDD\u6216\u914D\u7F6E\u5DF2\u88AB\u5176\u4ED6\u7F16\u8F91\u4FEE\u6539\u3002\u4FDD\u7559\u8349\u7A3F\uFF1B\u5148\u4E22\u5F03\u7F16\u8F91\u8BFB\u53D6\u5F53\u524D\u503C\u518D\u91CD\u8BD5\u3002",
    discard: "\u4E22\u5F03\u7F16\u8F91",
    reset: "\u6682\u5B58\u7EE7\u627F\u9ED8\u8BA4\u503C",
    readOnly: "\u5F53\u524D\u90E8\u7F72\u914D\u7F6E\u4E3A\u53EA\u8BFB\u3002",
    unavailable: "\u914D\u7F6E\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u542F\u7528\u63D2\u4EF6\uFF0C\u5FC5\u8981\u65F6\u91CD\u8F7D profile\uFF0F\u6D4F\u89C8\u5668\u3002"
  }
};

// client/index.js
var inject = ["locale", "slots", "configForms"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register("dshSessionMemory", { en: en_default.config, zh: zh_default.config }));
  ctx.effect(() => ctx.configForms.whileServed(["dsh-session-memory"], () => ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
    name: "plugins.row.config",
    key: "@shengxiao04/dsh-session-memory#dsh-session-memory",
    locale: "dshSessionMemory"
  }, ConfigPage))));
}

return module.exports;
} });
