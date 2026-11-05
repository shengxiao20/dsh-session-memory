import { validateConfig } from '../src/config-values.js';

export const FIELDS = [
  { key: 'discussion.enabled', type: 'checkbox' },
  { key: 'recall.limit', type: 'number', min: 1, max: 50 },
  { key: 'jev.enabled', type: 'checkbox' },
  { key: 'jev.model', type: 'text' },
  { key: 'jev.baseURL', type: 'text' },
  { key: 'jev.apiKeyEnv', type: 'text', optional: true },
  { key: 'jev.manageOllama', type: 'checkbox' },
  { key: 'jev.contextWindow', type: 'number', optional: true, min: 1024, max: 1048576 },
  { key: 'obsidian.enabled', type: 'checkbox' },
  { key: 'obsidian.vaultPath', type: 'text', optional: true },
];
export function fieldValue(value, key) { return key.split('.').reduce((node, part) => node?.[part], value); }
export function createDraft(state) {
  return { value: structuredClone(state.value), base: structuredClone(state.base), revision: state.revision, ops: [] };
}
export function editDraft(draft, field, input) {
  const path = field.key.split('.');
  const value = field.type === 'number' && input !== '' ? Number(input) : input;
  const op = field.optional && input === '' ? { op: 'unset', path } : { op: 'set', path, value };
  return { ...draft, ops: [...draft.ops.filter(item => item.path.join('.') !== field.key), op] };
}
export function resetDraft(draft) {
  return { ...draft, ops: [{ op: 'unset', path: ['discussion'] }, { op: 'unset', path: ['recall'] }, { op: 'unset', path: ['jev'] }, { op: 'unset', path: ['obsidian'] }] };
}
export function draftValue(draft) {
  const value = structuredClone(draft.value);
  for (const op of draft.ops) {
    const [group, field] = op.path;
    const inherited = op.path.reduce((node, part) => node?.[part], draft.base);
    if (field === undefined) value[group] = structuredClone(inherited);
    else {
      if (op.op === 'set') value[group][field] = op.value;
      else if (inherited === undefined) delete value[group][field];
      else value[group][field] = inherited;
    }
  }
  return value;
}
export function validateDraft(draft) {
  // Browser recognizes native absolute paths; the Host remains authoritative for its OS.
  return validateConfig(draftValue(draft), path => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path));
}
export async function saveDraft(form, draft) {
  if (form.state.status !== 'ready' || !form.state.writable) throw new Error('Configuration is unavailable or read-only.');
  if (!Number.isSafeInteger(draft.revision)) throw new Error('No accepted configuration revision.');
  validateDraft(draft);
  return form.mutate(draft.ops, draft.revision);
}
