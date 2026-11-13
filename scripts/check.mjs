/**
 * Illux Mosaik — quick project check (no dependencies):
 * 1. every JavaScript file parses (node --check),
 * 2. no leftovers from the old charity tool (webhooks, payments, donors) in shipped code,
 * 3. no global CSS selectors outside the ilx-mosaic scope in mosaic.css.
 * Run: npm run check
 */
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// The page and its code (the demo photos and examples are binary, so only the code files).
const shipped = ['src', 'index.html', 'page.js', 'page.css', '_headers'];
let failures = 0;
const fail = message => { failures++; console.error('FAIL ' + message); };

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) return [path];
  const files = [];
  for (const entry of entries) files.push(...await walk(join(path, entry.name)));
  return files;
}

const files = (await Promise.all(shipped.map(p => walk(join(root, p))))).flat();

for (const file of files.filter(f => /\.(m?js)$/.test(f)).concat(await walk(join(root, 'scripts')), await walk(join(root, 'tests')), await walk(join(root, 'tools')))) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (error) { fail('syntax: ' + relative(root, file) + '\n' + error.stderr); }
}

const forbidden = /n8n|webhook|mobilepay|donor|donation|donat|charity|callWebhook|HOPE/i;
for (const file of files.filter(f => !/\.(jpe?g|png|webp|gif)$/i.test(f))) { // images are binary
  const text = await readFile(file, 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    if (forbidden.test(line) && !/charity mosaic/i.test(line)) fail('leftover in ' + relative(root, file) + ':' + (index + 1) + ': ' + line.trim());
  });
}

const css = await readFile(join(root, 'src/styles/mosaic.css'), 'utf8');
const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/@keyframes\s+ilx-mosaic-[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '') // our own (prefixed) animations
  .replace(/@media[^{]+\{/g, '').split('}').map(block => block.split('{')[0].trim()).filter(Boolean);
for (const selector of selectors) {
  for (const part of selector.split(',')) {
    if (!/\.ilx-mosaic/.test(part)) fail('unscoped CSS selector: ' + part.trim());
  }
}

if (failures) { console.error(failures + ' problem(s).'); process.exit(1); }
console.log('OK: ' + files.length + ' shipped files checked.');
