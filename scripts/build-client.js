import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await mkdir(new URL('../dist', import.meta.url), { recursive: true });
const result = await build({
  entryPoints: ['client/index.js'], bundle: true, platform: 'browser', format: 'cjs', target: 'es2022',
  external: ['react'], write: false, metafile: true,
});
for (const path of Object.keys(result.metafile.inputs)) {
  if (path.includes('node_modules/') || path.startsWith('src/') && path !== 'src/config-values.js') throw new Error(`Client purity violation: ${path}`);
}
const { writeFile } = await import('node:fs/promises');
await writeFile(new URL('../dist/client.js', import.meta.url), `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {\nconst module = { exports: {} }; const exports = module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;\n} });\n`);
console.log('DSH client bundle built; React remains an external platform identity.');
