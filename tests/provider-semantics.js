"use strict";
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
const fs = require("fs");
const path = require("path");

const SRC = ["config", "state", "utils", "catalog", "keys", "rotation"]
  .map((f) => fs.readFileSync(path.join(__dirname, "..", "js", f + ".js"), "utf8"))
  .join("\n");
/* Test-only export tail: `let selectedModel` is module-private, so expose a setter. */
const TAIL = `
return {
  REG, MODELS, rotState, FALLBACK_ID,
  keyTestOutcome, testKey, keyRow, relayBase, relayUrl, relayNeeded,
  nativeIdUsable, parseNativeModels, applyNativeCatalog,
  avail, canServe, orHosts, idFor,
  __set: (k, v) => { if (k === "selectedModel") selectedModel = v; },
};`;

const mkEl = () => ({
  value: "",
  textContent: "",
  className: "",
  innerHTML: "",
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
  querySelector: () => null,
  querySelectorAll: () => [],
});

function run(store = {}, opts = {}) {
  const els = {};
  const el = (id) => (els[id] = els[id] || Object.assign(mkEl(), opts.els && opts.els[id]));
  const document = {
    getElementById: el,
    createElement: mkEl,
    body: mkEl(),
    addEventListener() {},
    querySelectorAll: () => [],
  };
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? String(store[k]) : null),
    setItem: (k, v) => (store[k] = String(v)),
    removeItem: (k) => delete store[k],
  };
  const fetch = opts.fetch || (async () => {
    throw new TypeError("Failed to fetch");
  });
  const api = new Function(
    "window", "localStorage", "document", "fetch",
    "regroupModels", "renderModelPicker", "selectModel",
    '"use strict";\n' + SRC + TAIL,
  )({}, localStorage, document, fetch, () => {}, () => {}, () => {});
  api.__els = els;
  // Everything the app logged through logRot(), read back out of the fake DOM
  // (a getter, because the log is written by the calls the test makes later).
  Object.defineProperty(api, "__log", {
    get: () => ((els.rotLog && els.rotLog.__kids) || []).map((n) => n.innerHTML + " " + (n.className || "")),
  });
  return api;
}
const seen = (c, re) => c.__log.some((h) => re.test(h));

let fails = 0;
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) console.log(`  ok  ${what}`);
  else { fails++; console.error(`  FAIL ${what}\n        got  ${a}\n        want ${b}`); }
};
const yes = (v, what) => eq(!!v, true, what);

async function main() {
  /* ── 1. the Test button's vocabulary ─────────────────────────────── */
  console.log("key test outcomes");
  {
    const c = run();
    const blocked = c.keyTestOutcome("blocked");
    eq(blocked.label, "Unverified", "a request the browser blocked reads Unverified");
    eq(blocked.dot, "", "…and leaves the key dot neutral");
    eq(blocked.btn, "", "…and never turns the button red");
    eq(blocked.type, "warn", "…and logs a warning, not an error");
    eq(c.keyTestOutcome("rejected", 401).label, "Fail", "401 reads Fail");
    eq(c.keyTestOutcome("rejected", 403).dot, "bad", "403 marks the key bad");
    eq(c.keyTestOutcome("ok").label, "OK ✓", "a 2xx reads OK");
    eq(c.keyTestOutcome("http", 503).label, "Saved", "a 5xx says saved, not invalid key");
    eq(c.keyTestOutcome("nolist").dot, "ok", "providers with no /models endpoint just save the key");
    eq(c.keyTestOutcome("empty").label, "Test", "no key → nothing to test");
  }

  /* ── 2. what a blocked/rejected test actually does to the app ────── */
  console.log("testKey side effects");
  {
    let calls = 0;
    const blocked = run({}, {
      els: { keyNvidia: { value: "nvapi-x" } },
      fetch: async () => { calls++; throw new TypeError("Failed to fetch"); },
    });
    await blocked.testKey("nvidia");
    eq(calls, 0, "no request is even attempted when a relay is required but missing");
    eq(blocked.__els.test_nvidia.textContent, "Unverified", "blocked fetch → button reads Unverified");
    eq(blocked.__els.test_nvidia.className, "btn-test", "blocked fetch → neutral button class");
    eq(blocked.rotState.nvidia, undefined, "blocked fetch does NOT blacklist the provider");
    eq(blocked.__els.dot_nvidia.className.trim(), "key-dot", "blocked fetch leaves the dot neutral");
    yes(seen(blocked, /CORS/i), "the log names CORS as the reason");
    yes(seen(blocked, /rot-evt warn/), "the log line is a warning, not an error");
    yes(seen(blocked, /wasn.t verified/i), "the log says the key wasn't verified");

    const rejected = run({ pg_relay_nvidia: "http://localhost:8765" }, { els: { keyNvidia: { value: "nvapi-bad" } }, fetch: async () => ({ ok: false, status: 401 }) });
    await rejected.testKey("nvidia");
    eq(rejected.__els.test_nvidia.textContent, "Fail", "401 → button reads Fail (with a relay to ask)");
    eq(rejected.rotState.nvidia.bad, true, "401 parks the provider until the key is edited");

    const noisy = run({ pg_relay_nvidia: "http://localhost:8765" }, { els: { keyNvidia: { value: "nvapi-x" } }, fetch: async () => ({ ok: false, status: 404 }) });
    await noisy.testKey("nvidia");
    eq(noisy.__els.test_nvidia.textContent, "Saved", "an odd HTTP status is not treated as a bad key");
    eq(noisy.rotState.nvidia, undefined, "…and doesn't park the provider");
  }

  /* ── 3. relay plumbing: URL rewriting + who needs one ────────────── */
  console.log("relay plumbing");
  {
    const none = run();
    eq(none.relayBase("nvidia"), "", "no relay stored by default");
    eq(none.relayUrl("nvidia", "https://integrate.api.nvidia.com/v1/chat/completions"),
      "https://integrate.api.nvidia.com/v1/chat/completions", "without a relay the provider URL is untouched");
    eq(none.relayNeeded("nvidia"), true, "NVIDIA needs a relay");
    eq(none.relayNeeded("groq"), false, "Groq doesn't (it sends CORS headers)");

    const withRelay = run({ pg_relay_nvidia: "http://localhost:8765/" });
    eq(withRelay.relayUrl("nvidia", "https://integrate.api.nvidia.com/v1/chat/completions"),
      "http://localhost:8765/chat/completions", "relay root replaces origin + /v1");
    eq(withRelay.relayUrl("nvidia", "https://integrate.api.nvidia.com/v1/models"),
      "http://localhost:8765/models", "the list endpoint is rewritten too");
    eq(withRelay.relayNeeded("nvidia"), false, "a stored relay satisfies the requirement");

    const v1 = run({ pg_relay_nvidia: "http://localhost:8787/v1" });
    eq(v1.relayUrl("nvidia", "https://integrate.api.nvidia.com/v1/chat/completions"),
      "http://localhost:8787/chat/completions", "a root written with or without /v1 means the same relay");

    for (const bad of ["javascript:alert(1)", "not a url", "ftp://host/v1", "   ", "http://evil.example/v1"])
      eq(run({ pg_relay_nvidia: bad }).relayBase("nvidia"), "", `refuses relay value ${JSON.stringify(bad)}`);
    eq(run({ pg_relay_nvidia: "https://relay.example.com/v1" }).relayBase("nvidia"),
      "https://relay.example.com", "an https relay off this machine is accepted");

    // The key test must use it, not the bare origin.
    let hit = "";
    const probe = run({ pg_relay_nvidia: "http://localhost:8765" }, {
      els: { keyNvidia: { value: "nvapi-x" } },
      fetch: async (u) => { hit = u; return { ok: true }; },
    });
    await probe.testKey("nvidia");
    eq(hit, "http://localhost:8765/models", "the key test is sent through the relay");
    eq(probe.__els.test_nvidia.textContent, "OK ✓", "a relayed 2xx is believed");
  }

  /* ── 4. rotation only offers reachable providers ─────────────────── */
  console.log("rotation availability");
  {
    eq(run().avail("nvidia"), false, "NVIDIA is unavailable without a relay");
    eq(run({ pg_relay_nvidia: "http://localhost:8765" }).avail("nvidia"), true, "NVIDIA is available through a relay");
    eq(run().avail("groq"), true, "other providers are unaffected");

    const c = run({ pg_or_catalog_v1: JSON.stringify({ ts: 1, models: [{ id: "some/other-model" }] }) });
    const m = c.MODELS["nv-dsv4f"];
    eq(c.canServe("nvidia", m), true, "NVIDIA serves its own id");
    eq(c.canServe("openrouter", m), false, "OpenRouter isn't offered an id it doesn't list");
  }

  /* ── 5. OpenRouter fallbacks are verified, not guessed ───────────── */
  console.log("OpenRouter fallback honesty");
  {
    const c = run();
    eq(c.orHosts("meta/llama-3.3-70b-instruct"), true, "with no catalog loaded, id shape decides");
    const live = run({ pg_or_catalog_v1: JSON.stringify({ ts: 1, models: [{ id: "deepseek/deepseek-v4-flash" }] }) });
    eq(live.orHosts("deepseek/deepseek-v4-flash"), true, "an id in the live catalog is hostable");
    eq(live.orHosts("meta/llama-3.3-70b-instruct"), false, "an NVIDIA-only id is not sent to OpenRouter");
    eq(live.idFor("openrouter", live.MODELS["nv-llama33"]), live.FALLBACK_ID.openrouter, "the fallback uses a real OpenRouter id instead of a guaranteed 404");
  }

  /* ── 6. native catalogs keep vendor-prefixed ids ────────────────── */
  console.log("native catalog id filter");
  {
    const c = run();
    yes(c.nativeIdUsable("nvidia", "meta/llama-3.3-70b-instruct"), "NVIDIA keeps vendor/model ids");
    yes(c.nativeIdUsable("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"), "OpenRouter keeps its namespaced ids");
    yes(c.nativeIdUsable("groq", "gpt-oss-120b"), "bare ids are always fine");
    eq(c.nativeIdUsable("groq", "meta/llama-3.3-70b-instruct"), false, "but they still aren't Groq's format");

    const payload = { data: [
      { id: "meta/llama-3.3-70b-instruct", name: "meta/llama-3.3-70b-instruct", context_length: 131072 },
      { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", name: "nvidia/llama-3.1-nemotron-ultra-253b-v1", context_length: 131072 },
      { id: "moonshotai/kimi-k2-instruct", name: "moonshotai/kimi-k2-instruct", context_length: 131072 },
      { id: "nvidia/embed-qa-4", name: "nvidia/embed-qa-4" },
    ] };
    const models = c.parseNativeModels("nvidia", payload);
    eq(models.length, 3, "non-chat endpoints (embeddings) filtered out");
    const before = Object.keys(c.MODELS).length;
    c.applyNativeCatalog("nvidia", models);
    eq(Object.keys(c.MODELS).length - before, 2, "live NVIDIA models reach the picker (curated ones already exist)");
    yes(c.MODELS["nat:nvidia:moonshotai/kimi-k2-instruct"], "the new NVIDIA model is registered under its real id");
    eq(c.MODELS["nv-llama33"].verified, true, "the curated NVIDIA id is verified against the live list");
  }

  /* ── 7. settings rows: only unreachable providers expose a relay field ── */
  console.log("settings UI wiring");
  {
    const c = run();
    yes(/data-relay="nvidia"/.test(c.keyRow("nvidia", "NVIDIA NIM", "nvapi-…")), "NVIDIA row carries the relay field");
    yes(/CORS/.test(c.keyRow("nvidia", "NVIDIA NIM", "nvapi-…")), "…and explains why");
    eq(/data-relay/.test(c.keyRow("groq", "Groq", "gsk_…")), false, "other rows stay one-line");
  }

  if (fails) {
    console.error(`\n${fails} check(s) failed`);
    process.exit(1);
  }
  console.log("\nprovider semantics: all good");
}
main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
