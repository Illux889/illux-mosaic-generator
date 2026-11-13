/**
 * Illux Mosaik — zero-dependency local server.
 *   node scripts/serve.mjs            -> http://localhost:8080/
 *   node scripts/serve.mjs --port 9000
 * Serves the repo root as static files and applies the same security headers
 * as the production `_headers` file, so framing and CSP behave like they will live.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};

/** Parse the Netlify/Cloudflare-style `_headers` file: "/path" lines followed by indented "Name: value" lines. */
async function loadHeaders() {
  const rules = [];
  try {
    const text = await readFile(join(root, '_headers'), 'utf8');
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      if (!/^\s/.test(line)) { current = { pattern: line.trim(), headers: [] }; rules.push(current); continue; }
      const index = line.indexOf(':');
      if (current && index > 0) current.headers.push([line.slice(0, index).trim(), line.slice(index + 1).trim()]);
    }
  } catch (_) { /* no _headers file */ }
  return rules;
}
const matches = (pattern, path) => pattern === path || (pattern.endsWith('*') && path.startsWith(pattern.slice(0, -1)));

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) || /[\\/](\.git|node_modules|reference)([\\/]|$)/.test(file)) { response.writeHead(404).end('Not found'); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { response.writeHead(404).end('Not found'); return; }
    const headers = { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    for (const rule of await loadHeaders()) if (matches(rule.pattern, path)) for (const [name, value] of rule.headers) headers[name] = value;
    response.writeHead(200, headers);
    response.end(await readFile(file));
  } catch (error) {
    response.writeHead(500).end('Server error');
    console.error(error);
  }
}).listen(port, () => console.log('Illux Mosaik: http://localhost:' + port + '/'));
