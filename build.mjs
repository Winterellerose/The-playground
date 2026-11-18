#!/usr/bin/env node
'use strict';
/* ════════════════════════════════════════════════════════════
   build.mjs — bundles the multi-file source into the single-file
   artifact. Zero dependencies: concatenating classic scripts in
   load order is exactly what the browser does with the <script src>
   tags, so docs/index.html is behavior-identical to the dev build.

   Usage:  node build.mjs
   Output: docs/index.html  (fully self-contained, file:// safe)
   ════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const fail = m => { console.error('\nBUILD FAILED: ' + m + '\n'); process.exit(1) };

/* Version info — embedded in the artifact and written to docs/version.txt */
const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim() } catch {}
const buildInfo = `<!-- Built: ${new Date().toISOString()} | v${version} | ${commit} -->`;

const ORDER = ['config', 'state', 'utils', 'markdown', 'catalog', 'keys', 'rotation', 'models', 'attachments', 'idb', 'search', 'chats', 'messages', 'api', 'streaming', 'extras', 'modals', 'events', 'app', 'pwa'];

const scriptTags = ORDER.map(f => '<script src="js/' + f + '.js"></script>').join('\n');

const css = read('css/app.css');
const markedSrc = read('js/vendor/marked.umd.js');
const purifySrc = read('js/vendor/purify.min.js');
const hljsJs = read('js/vendor/highlight.min.js');
const hljsCss = read('js/vendor/github-dark-dimmed.min.css');
const appJs = ORDER.map(f => '/* ═══ js/' + f + '.js ═══ */\n' + read('js/' + f + '.js')).join('\n');

/* Inlined JS must not contain the literal "</script" — it would terminate
   the script element early. The vendored libs shipped inline in the original
   monolith, so this should never trip; if it does, escape as <\/script. */
for (const [name, src] of [['marked', markedSrc], ['purify', purifySrc], ['highlight', hljsJs], ['app bundle', appJs]]) {
    if (/<\/script/i.test(src)) fail(name + ' contains "</script" — escape it as "<\\/script" before inlining');
}
if (/<\/style/i.test(css)) fail('app.css contains "</style"');
if (/<\/style/i.test(hljsCss)) fail('github-dark-dimmed.min.css contains "</style"');

/* Parse-check the concatenated bundle (catches ASI hazards at file seams). */
try { new Function(appJs) } catch (e) { fail('bundled JS does not parse: ' + e.message) }

let html = read('index.html');
const swap = (tag, inline) => {
    if (!html.includes(tag)) fail('tag not found in index.html: ' + tag.slice(0, 60));
    html = html.replace(tag, () => inline);
};
swap('<link rel="stylesheet" href="css/app.css">', '<style>\n' + css + '\n</style>');
swap('<link rel="stylesheet" href="js/vendor/github-dark-dimmed.min.css">', '<style>\n' + hljsCss + '\n</style>');
swap('<script src="js/vendor/highlight.min.js"></script>', '<script>\n' + hljsJs + '\n</script>');
swap('<script src="js/vendor/marked.umd.js"></script>', '<script>\n' + markedSrc + '\n</script>');
swap('<script src="js/vendor/purify.min.js"></script>', '<script>\n' + purifySrc + '\n</script>');

/* Match the script block regardless of line ending style (\n or \r\n) and leading whitespace. */
const scriptBlockRegex = new RegExp(
  ORDER.map(f => '\\s*<script src="js/' + f + '\\.js"></script>').join('\\r?\\n')
);
const scriptBlockMatch = html.match(scriptBlockRegex);
if (!scriptBlockMatch) fail('script block not found in index.html (check line endings / order)');
html = html.replace(scriptBlockMatch[0],
  '<!-- built from ' + ORDER.length + ' files — edit the sources, not this file -->\n<script>\n' + appJs + '\n</script>');

/* Post-inline checks ignore HTML comments. */
const stripComments = s => s.replace(/<!--[\s\S]*?-->/g, '');
if (/<script\s+src=/i.test(stripComments(html))) fail('a <script src> tag survived inlining');
if (/<link(?![^>]+fonts\.googleapis)[^>]+stylesheet/i.test(stripComments(html))) fail('the stylesheet <link> survived inlining');

/* Tighten CSP for production artifact. */
html = html.replace("script-src 'unsafe-inline' 'self'", "script-src 'unsafe-inline'");
html = html.replace("style-src 'unsafe-inline' 'self' https://fonts.googleapis.com", "style-src 'unsafe-inline' https://fonts.googleapis.com");
if (/(script|style)-src[^;]*'self'/.test(stripComments(html))) fail("dev CSP ('self') survived into the built artifact");

/* Inject build info. */
html = html.replace('</head>', buildInfo + '\n</head>');

mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'index.html'), html);
writeFileSync(join(ROOT, 'docs', 'version.txt'), `version: ${version}\ncommit: ${commit}\nbuilt: ${new Date().toISOString()}\n`);

/* Copy PWA assets. */
const PWA_ASSETS = ['manifest.webmanifest', 'sw.js'];
const PWA_DIRS = ['icons'];
for (const rel of PWA_ASSETS) {
    if (existsSync(join(ROOT, rel))) copyFileSync(join(ROOT, rel), join(ROOT, 'docs', rel));
}
for (const dir of PWA_DIRS) {
    if (existsSync(join(ROOT, dir))) {
        mkdirSync(join(ROOT, 'docs', dir), { recursive: true });
        for (const f of readdirSync(join(ROOT, dir))) copyFileSync(join(ROOT, dir, f), join(ROOT, 'docs', dir, f));
    }
}
console.log('\nBuilt docs/index.html (' + (html.length / 1024).toFixed(1) + ' KB — ' + ORDER.length + ' JS files + 2 vendored libs + CSS inlined)');
console.log('Dev:  open index.html directly (file:// works)');
console.log('Ship: docs/index.html is the self-contained artifact');