'use strict';
/* ═══ provider-semantics.js — unit checks for provider reachability ═══
   Pure and offline: the app's real modules are evaluated in a stubbed
   environment (localStorage / document / fetch) so the decisions that used to
   be folklore are asserted instead of trusted. What this pins down:
     · a CORS-blocked key test says "Unverified", never "Fail"
     · only a real 401/403 marks a key bad and parks the provider
     · a relay is honoured by the key test, the catalog and the chat call
     · NVIDIA is out of rotation until a CORS relay is configured
     · vendor/-prefixed native ids survive the catalog filter (NVIDIA!)
     · OpenRouter fallbacks are checked against the live catalog, not guessed
   Run: node tests/provider-semantics.js  (npm test runs it too) */
const fs = require('fs');
const path = require('path');

const SRC = ['config', 'state', 'utils', 'catalog', 'keys', 'rotation', 'models', 'extras']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'))
  .join('\n');
/* Test-only export tail: `let selectedModel` is module-private, so expose a setter. */
const TAIL = `
return {
  REG, MODELS, rotState, FALLBACK_ID,
  keyTestOutcome, testKey, keyRow, relayBase, relayUrl, relayNeeded,
  nativeIdUsable, parseNativeModels, applyNativeCatalog, applyCatalog,
  avail, canServe, orHosts, orIsFree, orCatalogHas, idFor,
  substituteOk, candidatesFor, servingPid, providerBlockNote, getCfg,
  creditWallMessage, metaCandidates,
  detectProviderForId, customModelVerify, addCustomModel, selectModel,
  updateUsageMeter, CUSTOM_PROV_KEY, lastCustomProv, renderModelPicker,
  __set: (k, v) => { if (k === "selectedModel") selectedModel = v;
                     if (k === "customModels") customModels = v; },
  __get: (k) => (k === "customModels" ? customModels : undefined),
};`;

const mkEl = () => ({
  value: '',
  textContent: '',
  className: '',
  innerHTML: '',
  style: {},
  scrollTop: 0,
  scrollHeight: 0,
  children: [],
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild(n) {
    (this.__kids = this.__kids || []).push(n);
    this.children.push(n);
  },
  removeChild() {
    (this.__kids = this.__kids || []).shift();
  },
  setAttribute() {},
  removeAttribute() {},
  focus() {},
  setSelectionRange() {},
  querySelector: () => null,
  querySelectorAll: () => [],
});

function run(store = {}, opts = {}) {
  const els = {};
  const el = id => (els[id] = els[id] || Object.assign(mkEl(), opts.els && opts.els[id]));
  const document = {
    getElementById: el,
    createElement: mkEl,
    body: mkEl(),
    addEventListener() {},
    querySelectorAll: () => [],
  };
  const localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? String(store[k]) : null),
    setItem: (k, v) => (store[k] = String(v)),
    removeItem: k => delete store[k],
  };
  const fetch =
    opts.fetch ||
    (async () => {
      throw new TypeError('Failed to fetch');
    });
  /* models.js/extras.js are in the bundle now (their function declarations
     shadow these stubs); the stubs cover only what those modules call OUTSIDE
     the bundle — attachments, modals and chat plumbing. */
  const api = new Function(
    'window',
    'localStorage',
    'document',
    'fetch',
    'regroupModels',
    'renderModelPicker',
    'selectModel',
    'chatSysText',
    'setAttachUI',
    'closeModelPicker',
    'getActiveChat',
    'saveChats',
    'renderSidebar',
    'renderFollowups',
    'webNeedsSearch',
    '"use strict";\n' + SRC + TAIL
  )(
    {},
    localStorage,
    document,
    fetch,
    () => {},
    () => {},
    () => {},
    () => '',
    () => {},
    () => {},
    () => null,
    () => {},
    () => {},
    () => {},
    () => false
  );
  api.__els = els;
  // Everything the app logged through logRot(), read back out of the fake DOM
  // (a getter, because the log is written by the calls the test makes later).
  Object.defineProperty(api, '__log', {
    get: () => ((els.rotLog && els.rotLog.__kids) || []).map(n => n.innerHTML + ' ' + (n.className || '')),
  });
  return api;
}
const seen = (c, re) => c.__log.some(h => re.test(h));

let fails = 0;
const eq = (got, want, what) => {
  const a = JSON.stringify(got),
    b = JSON.stringify(want);
  if (a === b) console.log(`  ok  ${what}`);
  else {
    fails++;
    console.error(`  FAIL ${what}\n        got  ${a}\n        want ${b}`);
  }
};
const yes = (v, what) => eq(!!v, true, what);

async function main() {
  /* ── 1. the Test button's vocabulary ─────────────────────────────── */
  console.log('key test outcomes');
  {
    const c = run();
    const blocked = c.keyTestOutcome('blocked');
    eq(blocked.label, 'Unverified', 'a request the browser blocked reads Unverified');
    eq(blocked.dot, '', '…and leaves the key dot neutral');
    eq(blocked.btn, '', '…and never turns the button red');
    eq(blocked.type, 'warn', '…and logs a warning, not an error');
    eq(c.keyTestOutcome('rejected', 401).label, 'Fail', '401 reads Fail');
    eq(c.keyTestOutcome('rejected', 403).dot, 'bad', '403 marks the key bad');
    eq(c.keyTestOutcome('ok').label, 'OK ✓', 'a 2xx reads OK');
    eq(c.keyTestOutcome('http', 503).label, 'Saved', 'a 5xx says saved, not invalid key');
    eq(c.keyTestOutcome('nolist').dot, 'ok', 'providers with no /models endpoint just save the key');
    eq(c.keyTestOutcome('empty').label, 'Test', 'no key → nothing to test');
  }

  /* ── 2. what a blocked/rejected test actually does to the app ────── */
  console.log('testKey side effects');
  {
    let calls = 0;
    const blocked = run(
      {},
      {
        els: { keyNvidia: { value: 'nvapi-x' } },
        fetch: async () => {
          calls++;
          throw new TypeError('Failed to fetch');
        },
      }
    );
    await blocked.testKey('nvidia');
    eq(calls, 0, 'no request is even attempted when a relay is required but missing');
    eq(blocked.__els.test_nvidia.textContent, 'Unverified', 'blocked fetch → button reads Unverified');
    eq(blocked.__els.test_nvidia.className, 'btn-test', 'blocked fetch → neutral button class');
    eq(blocked.rotState.nvidia, undefined, 'blocked fetch does NOT blacklist the provider');
    eq(blocked.__els.dot_nvidia.className.trim(), 'key-dot', 'blocked fetch leaves the dot neutral');
    yes(seen(blocked, /CORS/i), 'the log names CORS as the reason');
    yes(seen(blocked, /rot-evt warn/), 'the log line is a warning, not an error');
    yes(seen(blocked, /wasn.t verified/i), "the log says the key wasn't verified");

    const rejected = run(
      { pg_relay_nvidia: 'http://localhost:8765' },
      { els: { keyNvidia: { value: 'nvapi-bad' } }, fetch: async () => ({ ok: false, status: 401 }) }
    );
    await rejected.testKey('nvidia');
    eq(rejected.__els.test_nvidia.textContent, 'Fail', '401 → button reads Fail (with a relay to ask)');
    eq(rejected.rotState.nvidia.bad, true, '401 parks the provider until the key is edited');

    const noisy = run(
      { pg_relay_nvidia: 'http://localhost:8765' },
      { els: { keyNvidia: { value: 'nvapi-x' } }, fetch: async () => ({ ok: false, status: 404 }) }
    );
    await noisy.testKey('nvidia');
    eq(noisy.__els.test_nvidia.textContent, 'Saved', 'an odd HTTP status is not treated as a bad key');
    eq(noisy.rotState.nvidia, undefined, "…and doesn't park the provider");
  }

  /* ── 3. relay plumbing: URL rewriting + who needs one ────────────── */
  console.log('relay plumbing');
  {
    const none = run();
    eq(none.relayBase('nvidia'), '', 'no relay stored by default');
    eq(
      none.relayUrl('nvidia', 'https://integrate.api.nvidia.com/v1/chat/completions'),
      'https://integrate.api.nvidia.com/v1/chat/completions',
      'without a relay the provider URL is untouched'
    );
    eq(none.relayNeeded('nvidia'), true, 'NVIDIA needs a relay');
    eq(none.relayNeeded('groq'), false, "Groq doesn't (it sends CORS headers)");

    const withRelay = run({ pg_relay_nvidia: 'http://localhost:8765/' });
    eq(
      withRelay.relayUrl('nvidia', 'https://integrate.api.nvidia.com/v1/chat/completions'),
      'http://localhost:8765/chat/completions',
      'relay root replaces origin + /v1'
    );
    eq(
      withRelay.relayUrl('nvidia', 'https://integrate.api.nvidia.com/v1/models'),
      'http://localhost:8765/models',
      'the list endpoint is rewritten too'
    );
    eq(withRelay.relayNeeded('nvidia'), false, 'a stored relay satisfies the requirement');

    const v1 = run({ pg_relay_nvidia: 'http://localhost:8787/v1' });
    eq(
      v1.relayUrl('nvidia', 'https://integrate.api.nvidia.com/v1/chat/completions'),
      'http://localhost:8787/chat/completions',
      'a root written with or without /v1 means the same relay'
    );

    for (const bad of ['javascript:alert(1)', 'not a url', 'ftp://host/v1', '   ', 'http://evil.example/v1'])
      eq(run({ pg_relay_nvidia: bad }).relayBase('nvidia'), '', `refuses relay value ${JSON.stringify(bad)}`);
    eq(
      run({ pg_relay_nvidia: 'https://relay.example.com/v1' }).relayBase('nvidia'),
      'https://relay.example.com',
      'an https relay off this machine is accepted'
    );

    // The key test must use it, not the bare origin.
    let hit = '';
    const probe = run(
      { pg_relay_nvidia: 'http://localhost:8765' },
      {
        els: { keyNvidia: { value: 'nvapi-x' } },
        fetch: async u => {
          hit = u;
          return { ok: true };
        },
      }
    );
    await probe.testKey('nvidia');
    eq(hit, 'http://localhost:8765/models', 'the key test is sent through the relay');
    eq(probe.__els.test_nvidia.textContent, 'OK ✓', 'a relayed 2xx is believed');
  }

  /* ── 4. rotation only offers reachable providers ─────────────────── */
  console.log('rotation availability');
  {
    eq(run().avail('nvidia'), false, 'NVIDIA is unavailable without a relay');
    eq(run({ pg_relay_nvidia: 'http://localhost:8765' }).avail('nvidia'), true, 'NVIDIA is available through a relay');
    eq(run().avail('groq'), true, 'other providers are unaffected');

    const c = run({ pg_or_catalog_v1: JSON.stringify({ ts: 1, models: [{ id: 'some/other-model' }] }) });
    const m = c.MODELS['nv-dsv4f'];
    eq(c.canServe('nvidia', m), true, 'NVIDIA serves its own id');
    eq(c.canServe('openrouter', m), false, "OpenRouter isn't offered an id it doesn't list");
  }

  /* ── 5. OpenRouter fallbacks are verified, not guessed ───────────── */
  console.log('OpenRouter fallback honesty');
  {
    const c = run();
    eq(c.orHosts('meta/llama-3.3-70b-instruct'), true, 'with no catalog loaded, id shape decides');
    const live = run({ pg_or_catalog_v1: JSON.stringify({ ts: 1, models: [{ id: 'deepseek/deepseek-v4-flash' }] }) });
    eq(live.orHosts('deepseek/deepseek-v4-flash'), true, 'an id in the live catalog is hostable');
    eq(live.orHosts('meta/llama-3.3-70b-instruct'), false, 'an NVIDIA-only id is not sent to OpenRouter');
    eq(
      live.idFor('openrouter', live.MODELS['nv-llama33']),
      live.FALLBACK_ID.openrouter,
      'the fallback uses a real OpenRouter id instead of a guaranteed 404'
    );
  }

  /* ── 6. native catalogs keep vendor-prefixed ids ────────────────── */
  console.log('native catalog id filter');
  {
    const c = run();
    yes(c.nativeIdUsable('nvidia', 'meta/llama-3.3-70b-instruct'), 'NVIDIA keeps vendor/model ids');
    yes(
      c.nativeIdUsable('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free'),
      'OpenRouter keeps its namespaced ids'
    );
    yes(c.nativeIdUsable('groq', 'gpt-oss-120b'), 'bare ids are always fine');
    eq(c.nativeIdUsable('groq', 'meta/llama-3.3-70b-instruct'), false, "but they still aren't Groq's format");

    const payload = {
      data: [
        { id: 'meta/llama-3.3-70b-instruct', name: 'meta/llama-3.3-70b-instruct', context_length: 131072 },
        {
          id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
          name: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
          context_length: 131072,
        },
        { id: 'moonshotai/kimi-k2-instruct', name: 'moonshotai/kimi-k2-instruct', context_length: 131072 },
        { id: 'nvidia/embed-qa-4', name: 'nvidia/embed-qa-4' },
      ],
    };
    const models = c.parseNativeModels('nvidia', payload);
    eq(models.length, 3, 'non-chat endpoints (embeddings) filtered out');
    const before = Object.keys(c.MODELS).length;
    c.applyNativeCatalog('nvidia', models);
    eq(Object.keys(c.MODELS).length - before, 2, 'live NVIDIA models reach the picker (curated ones already exist)');
    yes(c.MODELS['nat:nvidia:moonshotai/kimi-k2-instruct'], 'the new NVIDIA model is registered under its real id');
    eq(c.MODELS['nv-llama33'].verified, true, 'the curated NVIDIA id is verified against the live list');
  }

  /* ── 7. settings rows: only unreachable providers expose a relay field ── */
  console.log('settings UI wiring');
  {
    const c = run();
    yes(/data-relay="nvidia"/.test(c.keyRow('nvidia', 'NVIDIA NIM', 'nvapi-…')), 'NVIDIA row carries the relay field');
    yes(/CORS/.test(c.keyRow('nvidia', 'NVIDIA NIM', 'nvapi-…')), '…and explains why');
    eq(/data-relay/.test(c.keyRow('groq', 'Groq', 'gsk_…')), false, 'other rows stay one-line');
  }

  /* ── 8. a FREE model is never re-routed onto a metered route ─────── */
  console.log('free models stay off metered routes');
  {
    // The reported bug: a model registered under NVIDIA NIM, an OpenRouter key
    // on hand, and OpenRouter listing the same id as a PAID model. NVIDIA is
    // unreachable without a CORS relay, so the request used to go to OpenRouter
    // and come back as "that model needs OpenRouter credits".
    const cat = {
      ts: 1,
      models: [
        { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', free: false },
        { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra', free: true },
      ],
    };
    const c = run(
      { pg_or_catalog_v1: JSON.stringify(cat) },
      { els: { keyORFree: { value: 'sk-or-x' }, keyNvidia: { value: 'nvapi-x' } } }
    );
    const m = c.MODELS['nv-llama33'];
    eq(m.provider, 'nvidia', 'the curated NVIDIA model belongs to NVIDIA');
    yes(c.orHosts(m.apiId), 'OpenRouter does list that id…');
    eq(c.orIsFree(m.apiId), false, '…but as a metered model, not a free one');
    eq(c.substituteOk('openrouter', m), false, 'so a FREE model is not substituted onto it');
    c.__set('selectedModel', 'nv-llama33');
    const cfg = c.getCfg();
    eq(cfg.pid, undefined, 'no OpenRouter request is built');
    yes(/NVIDIA NIM/.test(cfg.error || ''), "the error names the model's real provider");
    yes(/CORS relay/.test(cfg.error || ''), "…and says the CORS relay is what's missing");
    yes(/NOT re-routed to OpenRouter/.test(cfg.error || ''), '…and says the substitution was refused on purpose');

    // The same id, listed as FREE on OpenRouter: a legitimate fallback.
    const freeCat = { ts: 1, models: [{ id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', free: true }] };
    const f = run({ pg_or_catalog_v1: JSON.stringify(freeCat) }, { els: { keyORFree: { value: 'sk-or-x' } } });
    eq(
      f.substituteOk('openrouter', f.MODELS['nv-llama33']),
      true,
      'a free id on OpenRouter is still an allowed fallback'
    );
    f.__set('selectedModel', 'nv-llama33');
    eq(f.getCfg().pid, 'openrouter', '…and the request goes there');
    eq(f.getCfg().modelId, 'meta/llama-3.3-70b-instruct', '…with the same id, not a stand-in');
    yes(seen(f, /not used — routing via OpenRouter/), "…and the log says NVIDIA wasn't the one used");

    // With a relay the model never leaves NVIDIA.
    const r = run(
      { pg_relay_nvidia: 'http://localhost:8765', pg_or_catalog_v1: JSON.stringify(cat) },
      { els: { keyORFree: { value: 'sk-or-x' }, keyNvidia: { value: 'nvapi-x' } } }
    );
    r.__set('selectedModel', 'nv-llama33');
    eq(r.getCfg().pid, 'nvidia', 'with a relay configured the model stays on NVIDIA');
    eq(r.servingPid(r.MODELS['nv-llama33']), 'nvidia', 'and the header agrees with the request');

    // No catalog loaded: nothing may be sent to OpenRouter, and the app must
    // not claim OpenRouter would charge without the catalog to prove it.
    const g = run({}, { els: { keyORFree: { value: 'sk-or-x' } } });
    g.__set('selectedModel', 'nv-llama33');
    eq(g.getCfg().pid, undefined, 'with no catalog loaded nothing is sent to OpenRouter either');
    eq(/NOT re-routed/.test(g.getCfg().error || ''), false, "…and it doesn't assert a credit wall it can't verify");
    yes(/CORS relay/.test(g.getCfg().error || ''), 'the relay is still named as the fix');

    // Paid models may still route anywhere they are hosted.
    yes(
      c.substituteOk('openrouter', { provider: 'nvidia', apiId: 'meta/llama-3.3-70b-instruct', isFree: false }),
      'a PREMIUM model may use a metered route'
    );
  }

  /* ── 9. the header names the provider that will actually answer ──── */
  console.log('header honesty');
  {
    const freeCat = { ts: 1, models: [{ id: 'meta/llama-3.3-70b-instruct', free: true }] };
    const c = run({ pg_or_catalog_v1: JSON.stringify(freeCat) }, { els: { keyORFree: { value: 'sk-or-x' } } });
    c.selectModel('nv-llama33');
    yes(
      /NVIDIA NIM → OPENROUTER/.test(c.__els.frameMeta.textContent),
      'the header shows NVIDIA NIM → OpenRouter, not just NVIDIA NIM'
    );
    yes(/free/.test(c.__els.frameMeta.textContent), '…and still reads free');

    const blocked = run({}, { els: { keyORFree: { value: 'sk-or-x' } } });
    blocked.selectModel('nv-dsv4f');
    yes(
      seen(blocked, /NVIDIA NIM sends no CORS headers/),
      'picking an unreachable model warns at pick time, not after a failed send'
    );
  }

  /* ── 10. titles/follow-ups obey the same rule ───────────────────── */
  console.log('extras routing');
  {
    const cat = { ts: 1, models: [{ id: 'meta/llama-3.3-70b-instruct', free: false }] };
    const c = run(
      { pg_or_catalog_v1: JSON.stringify(cat) },
      { els: { keyORFree: { value: 'sk-or-x' }, keyNvidia: { value: 'nvapi-x' } } }
    );
    eq(c.metaCandidates(c.MODELS['nv-llama33']), [], 'titles/follow-ups are not generated by a metered route');
    const freeCat = { ts: 1, models: [{ id: 'nvidia/nemotron-3-ultra-550b-a55b:free', free: true }] };
    const f = run({ pg_or_catalog_v1: JSON.stringify(freeCat) }, { els: { keyORFree: { value: 'sk-or-x' } } });
    eq(f.metaCandidates(f.MODELS['nem-u']), ['openrouter'], '…but a genuinely free id still gets its chips');
  }

  /* ── 11. the 402 copy names the provider that sent it ───────────── */
  console.log('402 copy');
  {
    const c = run();
    yes(/OpenRouter/.test(c.creditWallMessage('openrouter', 'meta/x')), 'an OpenRouter 402 mentions OpenRouter');
    yes(/FREE/.test(c.creditWallMessage('openrouter_paid', 'meta/x')), '…and points at the free tier');
    const nv = c.creditWallMessage('nvidia', 'meta/llama-3.3-70b-instruct');
    yes(/NVIDIA NIM/.test(nv), 'a NVIDIA 402 says NVIDIA');
    eq(/OpenRouter/.test(nv), false, '…and never blames OpenRouter for it');
  }

  /* ── 12. a custom model can't be saved as OpenRouter's ──────────── */
  console.log('custom model provider honesty');
  {
    const store = {
      pg_native_catalog_v1: JSON.stringify({
        ts: 1,
        byPid: {
          nvidia: {
            ts: 1,
            models: [
              { id: 'meta/llama-3.1-70b-instruct', name: 'meta/llama-3.1-70b-instruct', context_length: 131072 },
            ],
          },
        },
      }),
      pg_or_catalog_v1: JSON.stringify({
        ts: 1,
        models: [{ id: 'nvidia/nemotron-3-ultra-550b-a55b:free', free: true }],
      }),
      pg_relay_nvidia: 'http://localhost:8765',
    };
    const c = run(store, {
      els: {
        keyNvidia: { value: 'nvapi-x' },
        cmProv: { value: 'openrouter' }, // the dropdown's default
        cmId: { value: 'meta/llama-3.1-70b-instruct' },
      },
    });
    eq(c.detectProviderForId('meta/llama-3.1-70b-instruct'), 'nvidia', 'the live NVIDIA list identifies its own id');
    eq(c.orCatalogHas('meta/llama-3.1-70b-instruct'), false, "OpenRouter's catalog does not list it");
    eq(c.orCatalogHas('nope/unknown'), false, '…and says so for any id it lacks');
    eq(run().orCatalogHas('nope/unknown'), null, 'with no catalog loaded the answer is unknown, not no');

    c.addCustomModel();
    eq(c.__get('customModels').length, 1, 'the model was added');
    eq(c.__get('customModels')[0].provider, 'nvidia', "…under NVIDIA, not the dropdown's OpenRouter default");
    eq(JSON.parse(store.pg_custom_models)[0].provider, 'nvidia', 'and that is what gets persisted');
    eq(store[c.CUSTOM_PROV_KEY], 'nvidia', 'the dropdown remembers the provider for next time');
    yes(seen(c, /Provider corrected to NVIDIA NIM/), 'the correction is announced, not silent');

    c.__set('selectedModel', c.__get('customModels')[0].id);
    const cfg = c.getCfg();
    eq(cfg.pid, 'nvidia', 'the saved custom model chats through NVIDIA');
    eq(cfg.modelId, 'meta/llama-3.1-70b-instruct', '…with its own id');

    // An id nobody's list knows still gets rejected with a useful reason.
    const d = run(store, { els: { cmProv: { value: 'openrouter' }, cmId: { value: 'acme/not-a-real-model' } } });
    const v = d.customModelVerify('openrouter', 'acme/not-a-real-model');
    yes(/isn't in the OpenRouter catalog/.test(v.err || ''), 'an unknown id is still rejected');
  }

  /* ── 13. the add form defaults to the last provider used ────────── */
  console.log('custom model form');
  {
    const c = run({ pg_custom_prov: 'nvidia' });
    eq(c.lastCustomProv(), 'nvidia', 'the last provider used is remembered');
    c.renderModelPicker();
    yes(/<option value="nvidia" selected>/.test(c.__els.mpBody.innerHTML), '…and preselected in the form');
    eq(run().lastCustomProv(), 'openrouter', 'a first add still defaults to OpenRouter');
    eq(run({ pg_custom_prov: 'not-a-provider' }).lastCustomProv(), 'openrouter', 'a stale saved provider is ignored');
  }

  /* ── 14. the live catalog can't re-price another provider's model ── */
  console.log('catalog reconciliation vs. price');
  {
    const c = run();
    eq(c.MODELS['nv-llama33'].isFree, true, 'the curated NVIDIA model starts out free');
    c.applyCatalog([
      { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', ctx: 128000, free: false, vision: false },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra', ctx: 1000000, free: true },
    ]);
    eq(
      c.MODELS['nv-llama33'].isFree,
      true,
      "OpenRouter charging for a cross-listed id does not re-price NVIDIA's own model"
    );
    eq(c.MODELS['nv-llama33'].verified, true, '…but it is still verified against the catalog');
    eq(c.MODELS['nv-llama33'].ctx, '128K', '…and its context length is still corrected');
    eq(
      c.substituteOk('openrouter', c.MODELS['nv-llama33']),
      false,
      'so it is still not substituted onto that metered route'
    );

    const d = run();
    d.applyCatalog([{ id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra', free: false }]);
    eq(d.MODELS['nem-u'].isFree, false, 'an OpenRouter-served id that turns paid IS re-priced');
  }

  if (fails) {
    console.error(`\n${fails} check(s) failed`);
    process.exit(1);
  }
  console.log('\nprovider semantics: all good');
}
main().catch(e => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
