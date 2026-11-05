import { ConfigPage } from './config-page.js';
import en from '../locale/en.json' with { type: 'json' };
import zh from '../locale/zh.json' with { type: 'json' };

export const inject = ['locale', 'slots', 'configForms'];
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('dshSessionMemory', { en: en.config, zh: zh.config }));
  ctx.effect(() => ctx.configForms.whileServed(['dsh-session-memory'], () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: '@shengxiao04/dsh-session-memory#dsh-session-memory',
    locale: 'dshSessionMemory',
  }, ConfigPage))));
}
