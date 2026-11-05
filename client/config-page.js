import { createElement as h, useEffect, useState } from 'react';
import { FIELDS, createDraft, editDraft, resetDraft, draftValue, fieldValue, saveDraft } from './config-editor.js';

const panel = { display: 'grid', gap: '14px', color: 'var(--dsw-alias-label-primary, inherit)', maxWidth: '680px' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '8px', border: '1px solid var(--dsw-alias-border-primary, #888)', borderRadius: '6px', color: 'inherit', background: 'var(--dsw-alias-background-primary, transparent)' };

function Editor({ form, t }) {
  const [draft, setDraft] = useState(() => createDraft(form.state));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const value = draftValue(draft);
  const disabled = !form.state.writable || saving;
  useEffect(() => {
    if (!saving && draft.ops.length === 0 && draft.revision !== form.state.revision) setDraft(createDraft(form.state));
  }, [form.state, draft, saving]);
  async function save(event) {
    event.preventDefault();
    setMessage('');
    setSaving(true);
    try {
      const accepted = await saveDraft(form, draft);
      if (accepted) { setDraft(current => ({ ...current, value: draftValue(current), ops: [] })); setMessage(t('saved')); }
      else setMessage(t('refused'));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  return h('form', { onSubmit: save, style: panel, 'aria-label': t('title') },
    h('p', null, t('intro')),
    !form.state.writable && h('p', { role: 'status' }, t('readOnly')),
    ...['discussion', 'recall', 'jev', 'obsidian'].map(group => h('fieldset', { key: group, disabled, style: panel },
      h('legend', null, t(group)),
      ...FIELDS.filter(field => field.key.startsWith(`${group}.`)).map(field => h('label', { key: field.key, style: { display: 'grid', gap: '6px' } },
        h('span', null, t(field.key)),
        h('input', {
          type: field.type, name: field.key, style: field.type === 'checkbox' ? undefined : inputStyle,
          ...(field.type === 'checkbox' ? { checked: fieldValue(value, field.key) } : { value: fieldValue(value, field.key) ?? '' }),
          ...(field.type === 'number' ? { min: field.min, max: field.max, step: 1 } : {}),
          onChange: event => setDraft(current => editDraft(current, field, field.type === 'checkbox' ? event.target.checked : event.target.value)),
        }),
        h('small', null, t(`${field.key}.hint`)),
      )),
    )),
    h('div', { style: { display: 'flex', gap: '12px' } },
      h('button', { type: 'submit', disabled: disabled || draft.ops.length === 0 }, t(saving ? 'saving' : 'save')),
      h('button', { type: 'button', disabled, onClick: () => { setDraft(createDraft(form.state)); setMessage(''); } }, t('discard')),
      h('button', { type: 'button', disabled, onClick: () => { setDraft(current => resetDraft(current)); setMessage(''); } }, t('reset')),
    ),
    message && h('p', { role: 'status', style: { overflowWrap: 'anywhere' } }, message),
  );
}
export function ConfigPage({ view, form, t }) {
  if (view === 'summary') return t('summary');
  if (!form || form.state.status !== 'ready') return h('p', { role: 'status' }, t('unavailable'));
  return h(Editor, { form, t });
}
