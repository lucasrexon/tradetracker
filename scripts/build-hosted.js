/**
 * Build the hosted site and turn Vite's index.html into the page fragment the
 * claude.ai Artifact host expects (it adds its own doctype/html/head/body).
 * Output: web/dist-hosted/page.html plus web/dist-hosted/assets/*, and
 * web/dist-hosted/files.json mapping published paths to local files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web', 'dist-hosted');

await build({ configFile: path.join(root, 'vite.hosted.config.js'), logLevel: 'warn' });

const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];

const keep = head
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !/^<meta (charset|name="viewport")/.test(l))
  .join('\n');
// Title first: the host only scans the first 8 KB for it.
const title = keep.match(/<title>[\s\S]*?<\/title>/)[0];
const rest = keep.replace(title, '').replaceAll('"./assets/', '"assets/');

const page = `${title}\n${rest}\n${body.trim().replaceAll('"./assets/', '"assets/')}\n`;
fs.writeFileSync(path.join(out, 'page.html'), page);

const files = {};
for (const f of fs.readdirSync(path.join(out, 'assets'))) {
  files[`assets/${f}`] = path.relative(root, path.join(out, 'assets', f));
}
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files, null, 2));
console.log(`page.html ${(page.length / 1024).toFixed(1)} KB, ${Object.keys(files).length} asset files`);
