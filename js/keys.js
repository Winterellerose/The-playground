"use strict";
/* ═══ keys.js — API key UI, testing, persistence ═══ */

/* ── Keys ── */
const KEY_DEFS = [
  ["openrouter", "OpenRouter", "sk-or-…"],
  ["groq", "Groq", "gsk_…"],
  ["cerebras", "Cerebras", "csk-…"],
  ["gemini", "Google Gemini", "AIzaSy…"],
  ["mistral", "Mistral", "…"],
  ["cohere", "Cohere", "…"],
  ["nvidia", "NVIDIA NIM", "nvapi-…"],
  ["deepseek", "DeepSeek", "sk-…"],
  ["openrouter_paid", "OpenRouter (Paid)", "sk-or-…"],
  ["zai", "Z.ai", "…"],
  ["anthropic", "Anthropic", "sk-ant-…"],
  ["openai", "OpenAI", "sk-…"],
  ["sambanova", "SambaNova", "…"],
  ["atria", "Atria Dawn", "atria-…"],
];
function buildKeyInputs() {
  const local = Object.keys(REG).filter((p) => REG[p].local);
  $("freeKeys").innerHTML = KEY_DEFS.filter((d) => REG[d[0]].type === "free")
    .map((d) => keyRow(d[0], d[1], d[2]))
    .join("");
  $("freeKeys").insertAdjacentHTML("beforeend", local.map((p) => `<div class="sb-key"><span class="sb-key-label" id="local_${p}">${REG[p].name} — checking…</span></div>`).join(""));
  refreshLocalStatus();
  $("paidKeys").innerHTML = KEY_DEFS.filter((d) => REG[d[0]].type === "paid")
    .map((d) => keyRow(d[0], d[1], d[2]))
    .join("");
}
function keyRow(pid, label, ph) {
  const inp = KEY_INPUTS[pid];
  // Providers whose API sends no CORS headers get an optional relay field:
  // without one the browser can't reach them at all, and we say so instead of
  // blaming the key.
  const relay = REG[pid].noCors
    ? `<div class="sb-key-row" style="margin-top:4px"><label class="sb-key-label" for="relay_${pid}">CORS relay</label><input type="text" id="relay_${pid}" data-relay="${pid}" placeholder="http://localhost:8765 (optional)" spellcheck="false" autocomplete="off" value="${esc(relayBase(pid))}"></div><p class="sb-key-help">Their API sends no CORS headers, so this page can't call it directly. Point this at a local relay that forwards to ${esc(REG[pid].models.replace(/\/v1.*$/, "/v1"))} and the key test, model list and chats all go through it.</p>`
    : "";
  return `<div class="sb-key"><div class="sb-key-row"><label class="sb-key-label" for="${inp}"><span class="key-dot" id="dot_${pid}"></span>${label}</label><input type="password" id="${inp}" placeholder="${ph}" spellcheck="false" autocomplete="off" data-pid="${pid}"></div><div style="display:flex;gap:6px;align-items:center"><span style="font-family:var(--font-mono);font-size:.56rem;color:var(--text-faint);text-transform:uppercase">${REG[pid].rpm}</span><button class="btn-test" id="test_${pid}" data-act="test-key" data-pid="${pid}">Test</button></div>${relay}</div>`;
}
function getKey(pid) {
  const el = $(KEY_INPUTS[pid]);
  return el ? el.value.trim() : "";
}
function onKeyEdit(pid) {
  rotState[pid] = { ...(rotState[pid] || {}), bad: false };
  setDot(pid, getKey(pid) ? "ok" : "empty");
  saveAll();
  // A key may unlock a provider's live catalog, but never send a /models
  // request for every character while the user is still typing it.
  clearTimeout(nativeRefreshTimer);
  nativeRefreshTimer = setTimeout(() => {
    try {
      localStorage.removeItem(NATIVE_CAT_KEY);
    } catch {}
    refreshNativeCatalogs();
  }, 700);
}
function onRelayEdit(pid) {
  const el = $("relay_" + pid);
  try {
    if (el && el.value.trim()) localStorage.setItem(RELAY_KEY + pid, el.value.trim());
    else localStorage.removeItem(RELAY_KEY + pid);
  } catch {}
  clearTimeout(nativeRefreshTimer);
  nativeRefreshTimer = setTimeout(() => {
    try {
      localStorage.removeItem(NATIVE_CAT_KEY);
    } catch {}
    refreshNativeCatalogs();
  }, 700);
}
function setDot(pid, state) {
  const d = $("dot_" + pid);
  if (d)
    d.className =
      "key-dot " + (state === "ok" ? "ok" : state === "bad" ? "bad" : "");
}
/* Pure classifier behind the Test button, kept apart from the DOM so
   tests/provider-semantics.js can pin it. The whole point: "the browser never
   got a response" is NOT evidence about the key, so it must not render Fail. */
function keyTestOutcome(kind, status) {
  if (kind === "ok")
    return { dot: "ok", btn: "ok", label: "OK ✓", type: "ok", msg: "key valid" };
  if (kind === "blocked")
    return {
      dot: "",
      btn: "",
      label: "Unverified",
      type: "warn",
      msg: "key saved — their API can't be reached from a browser (no CORS headers), so it wasn't verified. Add a relay above to test it, or just send a message",
    };
  if (kind === "rejected")
    return {
      dot: "bad",
      btn: "err",
      label: "Fail",
      type: "err",
      msg: `key rejected (${status}) — fix it above`,
    };
  if (kind === "http")
    return {
      dot: "",
      btn: "",
      label: "Saved",
      type: "warn",
      msg: `key saved — their list endpoint answered HTTP ${status}, which says nothing about the key`,
    };
  if (kind === "nolist")
    return {
      dot: "ok",
      btn: "ok",
      label: "OK ✓",
      type: "ok",
      msg: "key saved (no list endpoint to ping)",
    };
  return {
    dot: "",
    btn: "",
    label: "Test",
    type: "warn",
    msg: "no key to test",
  };
}
async function testKey(pid) {
  const key = getKey(pid),
    btn = $("test_" + pid);
  const paint = (o) => {
    setDot(pid, o.dot);
    if (btn) {
      btn.textContent = o.label;
      btn.className = "btn-test" + (o.btn ? " " + o.btn : "");
    }
    logRot(`${REG[pid].name}: ${o.msg}`, o.type);
  };
  if (!key) return paint(keyTestOutcome("empty"));
  if (!REG[pid].models) return paint(keyTestOutcome("nolist"));
  // Don't even fire a request the browser is going to kill: the answer is
  // already known ("Unverified — needs a relay") and the console stays clean.
  if (relayNeeded(pid)) return paint(keyTestOutcome("blocked"));
  btn.textContent = "…";
  try {
    const h = { "Content-Type": "application/json" };
    if (pid === "anthropic") {
      h["x-api-key"] = key;
      h["anthropic-version"] = "2023-06-01";
      h["anthropic-dangerous-direct-browser-access"] = "true";
    } else h["Authorization"] = "Bearer " + key;
    const res = await fetch(relayUrl(pid, REG[pid].models), { headers: h });
    if (res.ok) paint(keyTestOutcome("ok"));
    else if (res.status === 401 || res.status === 403) {
      // A real rejection: park the provider out of rotation until it's edited.
      rotState[pid] = { ...(rotState[pid] || {}), bad: true };
      paint(keyTestOutcome("rejected", res.status));
    } else paint(keyTestOutcome("http", res.status));
  } catch {
    // A failed fetch means the request never completed: CORS-blocked, offline,
    // or a relay that isn't running. Report it as unverified, never as Fail.
    const via = relayBase(pid);
    paint(
      Object.assign(keyTestOutcome("blocked"), {
        msg: via
          ? `key saved — the CORS relay at ${via} didn't answer (is it running?)`
          : keyTestOutcome("blocked").msg,
      }),
    );
  }
}
function loadAll() {
  KEY_DEFS.forEach(([pid]) => {
    const el = $(KEY_INPUTS[pid]);
    if (el) el.value = localStorage.getItem("key_" + pid) || "";
  });
  $("sysPrompt").value = localStorage.getItem("sys_prompt") || "";
  $("maxTok").value = localStorage.getItem("pg_maxtok") || "8192";
  $("extrasMode").value = localStorage.getItem("pg_extras_mode") || "free";
  loadSearchCfg();
  refreshKeyUI();
}
function saveAll() {
  KEY_DEFS.forEach(([pid]) =>
    localStorage.setItem("key_" + pid, $(KEY_INPUTS[pid]).value),
  );
  localStorage.setItem("sys_prompt", $("sysPrompt").value);
  localStorage.setItem("pg_maxtok", $("maxTok").value || "8192");
  localStorage.setItem("pg_extras_mode", $("extrasMode").value || "free");
  refreshKeyUI();
}
function loadSearchCfg() {
  const sel = $("searchProvider");
  if (sel) sel.value = localStorage.getItem("pg_search_provider") || "auto";
  renderSearchFields();
}
function saveSearchCfg() {
  const sel = $("searchProvider");
  if (sel) localStorage.setItem("pg_search_provider", sel.value);
  // Persist in place. Rebuilding the field here would destroy focus after
  // every typed character; provider changes render explicitly via onchange.
  Object.entries(SEARCH_PROVIDERS).forEach(([id, p]) => {
    const inp = $("searchKey_" + id);
    if (inp) localStorage.setItem(p.key, inp.value.trim());
  });
}
function renderSearchFields() {
  const box = $("searchKeyFields");
  if (!box) return;
  const chosen = localStorage.getItem("pg_search_provider") || "auto";
  // In Auto mode show all key fields; otherwise show just the chosen one.
  const show = chosen === "auto" ? Object.keys(SEARCH_PROVIDERS) : [chosen];
  box.innerHTML = show
    .map((id) => {
      const p = SEARCH_PROVIDERS[id];
      const val = localStorage.getItem(p.key) || "";
      return `<div class="sb-key" style="margin-bottom:6px"><div class="sb-key-row"><label class="sb-key-label" style="width:130px" for="searchKey_${id}">${p.name} key</label><input type="password" id="searchKey_${id}" placeholder="tvly-… / key…" spellcheck="false" autocomplete="off" value="${esc(val)}"></div></div>`;
    })
    .join("");
  // Bind at creation: rebuilding happens only on explicit provider change,
  // so focus is never destroyed while typing.
  box
    .querySelectorAll("input")
    .forEach((i) => i.addEventListener("input", saveSearchCfg));
}
function refreshKeyUI() {
  let f = 0,
    p = 0;
  KEY_DEFS.forEach(([pid]) => {
    const has = !!getKey(pid);
    if (!(rotState[pid] && rotState[pid].bad))
      setDot(pid, has ? "ok" : "empty");
    REG[pid].type === "free" ? (f += has) : (p += has);
  });
  $("freeKeyCount").textContent = `${f} key${f !== 1 ? "s" : ""} set`;
  $("paidKeyCount").textContent = `${p} key${p !== 1 ? "s" : ""} set`;
}

async function refreshLocalStatus() { for (const pid of Object.keys(REG).filter((p)=>REG[p].local)) { const el=$("local_"+pid); try { const r=await fetch(REG[pid].models); if(el) el.textContent=REG[pid].name+" — "+(r.ok?"reachable":"not reachable"); } catch { if(el) el.textContent=REG[pid].name+" — not reachable"; } } }
