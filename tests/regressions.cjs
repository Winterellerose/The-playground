const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { IDBFactory } = require('fake-indexeddb');
const source = name => fs.readFileSync(name, 'utf8');
function context(extra = {}) {
  const ctx = vm.createContext({ console, URL, setTimeout, clearTimeout, crypto: globalThis.crypto,
    localStorage: { getItem: () => null }, window: {}, document: { getElementById: () => null }, ...extra });
  return ctx;
}

test('CSP permits all configured provider and search endpoints', () => {
  const ctx = context();
  vm.runInContext(source('js/config.js') + '\nthis.providers = REG;', ctx);
  const connect = source('index.html').replace(/<!--[\s\S]*?-->/g, '').match(/connect-src ([^;]+)/)[1].split(/\s+/);
  for (const provider of Object.values(ctx.providers)) {
    for (const endpoint of [provider.url, provider.models].filter(Boolean)) {
      assert.ok(connect.includes(new URL(endpoint).origin), endpoint);
    }
  }
});

test('attachment text counts toward context; oversized current turn is rejected', () => {
  const ctx = context({ MODELS: { test: { ctx: '4K' } }, selectedModel: 'test', parseCtx: () => 4000,
    $: () => ({ value: '1000' }) });
  vm.runInContext(source('js/api.js'), ctx);
  ctx.chat = { model: 'test', messages: [
    { role: 'user', content: 'old', files: [{ text: 'a'.repeat(16000) }] },
    { role: 'assistant', content: 'answer' }, { role: 'user', content: 'new' },
  ] };
  const result = vm.runInContext('cleanHistory(chat, 3)', ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].content, 'new');
  ctx.chat.messages = [{ role: 'user', content: 'new', files: [{ text: 'a'.repeat(16000) }] }];
  assert.throws(() => vm.runInContext('cleanHistory(chat, 1)', ctx), /exceed/);
});

test('malformed stored data is preserved and blocks overwrites', () => {
  for (const raw of ['{}', 'null', '[{"id":"x","messages":null}]', '{broken']) {
    const ctx = context({ localStorage: { getItem: key => key === 'chat_history' ? raw : null } });
    vm.runInContext(source('js/state.js'), ctx);
    assert.equal(vm.runInContext('chatRecoveryBlocked', ctx), true);
    assert.equal(vm.runInContext('chats.length', ctx), 0);
  }
});

test('image hydration preserves canonical refs; cleanup removes only unreachable images', async () => {
  const indexedDB = new IDBFactory();
  const ctx = context({ indexedDB, window: { indexedDB }, logRot() {} });
  vm.runInContext(source('js/idb.js'), ctx);
  await vm.runInContext("idbPut('keep', 'data:image/png;base64,YQ==')", ctx);
  await vm.runInContext("idbPut('orphan', 'data:image/png;base64,Yg==')", ctx);
  ctx.chat = { messages: [{ images: [{ idb: 'keep', mime: 'image/png', name: 'image' }] }] };
  const hydrated = await vm.runInContext('hydrateImages(chat)', ctx);
  assert.equal(hydrated.messages[0].images[0], 'data:image/png;base64,YQ==');
  assert.equal(ctx.chat.messages[0].images[0].idb, 'keep');
  await vm.runInContext('pruneStoredImages([chat])', ctx);
  assert.equal(await vm.runInContext("idbGet('orphan')", ctx), undefined);
  assert.equal(await vm.runInContext("idbGet('keep')", ctx), 'data:image/png;base64,YQ==');
  ctx.chat.messages[0].images[0].idb = 'missing';
  await vm.runInContext('hydrateImages(chat)', ctx);
  assert.equal(ctx.chat.messages[0].images[0].idb, 'missing');
});

test('catalog generator preserves stable IDs/capabilities and validates input', async () => {
  const { updateModels } = await import('../scripts/update-models.js');
  const original = source('js/config.js');
  const catalog = { data: [{ id: 'google/gemma-4-26b-a4b-it:free' },
    { id: 'vendor/new:free', name: 'A "quoted" model', context_length: 32000 }] };
  const updated = updateModels(original, catalog);
  const models = vm.runInNewContext(updated + '\nMODELS;', { window: {} });
  assert.equal(models['gemma-4'].vision, true);
  assert.ok(models['groq-oss120']);
  assert.equal(updateModels(updated, catalog), updated);
  assert.throws(() => updateModels(original, { data: [] }), /Empty/);
  assert.throws(() => updateModels(original, { data: [{ id: 'paid' }] }), /No free/);
});

test('relay policies use exact hosted origins and restricted routes', async () => {
  const { allowedOrigin, allowedRoute } = await import('../relay-policy.js');
  assert.equal(allowedOrigin('https://app.example', 'https://app.example'), true);
  assert.equal(allowedOrigin('https://app.example.evil', 'https://app.example'), false);
  assert.equal(allowedOrigin('https://attacker.workers.dev.evil'), false);
  assert.equal(allowedRoute('POST', '/v1/chat/completions'), true);
  assert.equal(allowedRoute('GET', '//evil.example'), false);
});

test('Node relay forwards real requests, preflight, bytes, and rejects untrusted origins', async t => {
  let hit;
  const upstream = createServer((req, res) => {
    hit = req.url;
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('data: {"ok":true}\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => upstream.close());
  const child = spawn(process.execPath, ['nim-cors-proxy.js', '--port', '0', '--target',
    `http://127.0.0.1:${upstream.address().port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Relay startup timed out')), 5000);
    child.stdout.on('data', data => {
      const match = String(data).match(/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Relay exited: ' + code)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(base + '/v1/models', { headers: { Origin: 'http://localhost:8000' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8000');
  assert.match(await response.text(), /"ok":true/);
  assert.equal(hit, '/v1/models');
  assert.equal((await fetch(base + '/v1/models', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/other')).status, 404);
  assert.equal((await fetch(base + '/v1/models', { method: 'OPTIONS' })).status, 204);
});

function streamContext(extra = {}) {
  const body = { classList: { remove() {} }, querySelector: () => null };
  const ctx = context({ AbortController, TextDecoder, performance,
    getCfg: () => ({ pid: 'test', model: {}, modelId: 'test', webSearch: 'off' }),
    cleanHistory: () => [], hydrateHistImages: async h => h,
    buildRequest: () => ({ h: {}, rb: {} }), chatSysText: () => '',
    $: () => ({ value: '' }), REG: { test: { name: 'Test', url: 'https://provider.example' } },
    relayUrl: (_, url) => url, relayBase: () => '', logRot() {}, markOk() {},
    streamGen: 1, stopGen: -1, abortCtrl: null, showError() {}, ...extra });
  vm.runInContext(source('js/streaming.js'), ctx);
  ctx.chat = { messages: [] };
  ctx.div = { dataset: { idx: '0' }, querySelector: () => body };
  return ctx;
}

test('stopped generation never fetches after image hydration', async () => {
  let release;
  let calls = 0;
  const ctx = streamContext({ hydrateHistImages: () => new Promise(resolve => { release = resolve; }),
    fetch: () => { calls++; throw Error('Should not fetch'); } });
  const pending = vm.runInContext('doStream(chat, div, [], 1)', ctx);
  vm.runInContext('streamGen = 2; abortCtrl.abort(); abortCtrl = null;', ctx);
  release([]);
  assert.equal((await pending).aborted, true);
  assert.equal(calls, 0);
});

test('HTTP 200 SSE error is surfaced instead of silently succeeding', async () => {
  const errors = [];
  const ctx = streamContext({ showError: message => errors.push(message), fetch: async () => new Response(
    'data: {"type":"error","error":{"message":"Overloaded"}}\n\n', { status: 200 }) });
  const result = await vm.runInContext('doStream(chat, div, [], 1)', ctx);
  assert.equal(result.content, '');
  assert.deepEqual(errors, ['Overloaded']);
});

test('built HTML scripts parse after insertion and preserve literal dollar sequences', () => {
  const html = source('docs/index.html');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 4);
  for (const [, script] of scripts) new vm.Script(script);
  assert.ok(scripts[3][1].includes(source('js/models.js')));
});

test('Worker forwards only trusted routes and preserves /v1', async t => {
  const worker = (await import('../nim-cors-proxy.workers.js')).default;
  const original = globalThis.fetch;
  let hit;
  globalThis.fetch = async (url, init) => {
    hit = { url: String(url), init };
    return new Response('data: [DONE]\n\n', { headers: { 'Access-Control-Allow-Origin': '*' } });
  };
  t.after(() => { globalThis.fetch = original; });
  const request = new Request('https://relay.example/v1/models', { headers: { Origin: 'https://app.example' } });
  assert.equal((await worker.fetch(request)).status, 403);
  const response = await worker.fetch(request, { ALLOWED_ORIGINS: 'https://app.example' });
  assert.equal(response.status, 200);
  assert.equal(hit.url, 'https://integrate.api.nvidia.com/v1/models');
  assert.equal(hit.init.redirect, 'manual');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  assert.equal(await response.text(), 'data: [DONE]\n\n');
});


test('featured picks have checked routes and removed provider is not offered anywhere', () => {
  // Checked against /api/v1/models/{author}/{model}/endpoints on 2026-11-19.
  const ctx = context();
  vm.runInContext(source('js/config.js') + '\nregroupModels(); this.featured = Object.values(MODELS).filter(m => m.group === "featured"); this.registry = REG; this.keys = KEY_INPUTS; this.fallbacks = FALLBACK_ID;', ctx);
  const expected = new Map([
    ['z-ai/glm-5.3-flash', { provider: 'openrouter_paid', free: false }],
    ['nvidia/nemotron-3.5-lightning:free', { provider: 'openrouter', free: true }],
    ['nvidia/nemotron-3-ultra-550b-a55b:free', { provider: 'openrouter', free: true }],
  ]);
  assert.equal(ctx.featured.length, expected.size);
  for (const model of ctx.featured) {
    const checked = expected.get(model.apiId);
    assert.ok(checked, model.apiId);
    assert.equal(model.provider, checked.provider);
    assert.equal(model.isFree, checked.free);
    assert.ok(ctx.registry[model.provider]);
  }
  assert.equal(ctx.registry.atria, undefined);
  assert.equal(ctx.keys.atria, undefined);
  assert.equal(ctx.fallbacks.atria, undefined);
  for (const path of ['js/config.js', 'js/keys.js', 'index.html', 'docs/index.html']) {
    assert.doesNotMatch(source(path), /atria-dawn|api\.atria-asi\.ai|keyAtria|Atria Dawn/i, path);
  }
});
