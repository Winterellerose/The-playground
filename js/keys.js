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
  return `<div class="sb-key"><div class="sb-key-row"><label class="sb-key-label" for="${inp}"><span class="key-dot" id="dot_${pid}"></span>${label}</label><input type="password" id="${inp}" placeholder="${ph}" spellcheck="false" autocomplete="off" data-pid="${pid}"></div><div style="display:flex;gap:6px;align-items:center"><span style="font-family:var(--font-mono);font-size:.56rem;color:var(--text-faint);text-transform:uppercase">${REG[pid].rpm}</span><button class="btn-test" id="test_${pid}" data-act="test-key" data-pid="${pid}">Test</button></div></div>`;
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
function setDot(pid, state) {
  const d = $("dot_" + pid);
  if (d)
    d.className =
      "key-dot " + (state === "ok" ? "ok" : state === "bad" ? "bad" : "");
}
async function testKey(pid) {
  const key = getKey(pid),
    btn = $("test_" + pid);
  if (!key) {
    setDot(pid, "empty");
    btn.textContent = "Test";
    btn.className = "btn-test";
    return logRot(`${REG[pid].name}: no key to test`, "warn");
  }
  if (!REG[pid].models) {
    setDot(pid, "ok");
    btn.textContent = "OK ✓";
    btn.className = "btn-test ok";
    return logRot(
      `${REG[pid].name}: key saved (no list endpoint to ping)`,
      "ok",
    );
  }
  btn.textContent = "…";
  try {
    const h = { "Content-Type": "application/json" };
    if (pid === "anthropic") {
      h["x-api-key"] = key;
      h["anthropic-version"] = "2023-06-01";
      h["anthropic-dangerous-direct-browser-access"] = "true";
    } else h["Authorization"] = "Bearer " + key;
    const res = await fetch(REG[pid].models, { headers: h });
    if (res.ok) {
      setDot(pid, "ok");
      btn.textContent = "OK ✓";
      btn.className = "btn-test ok";
      logRot(`${REG[pid].name} key valid`, "ok");
      return;
    }
    // Pull NVIDIA's real reason (401/403 = key rejected, 404 = endpoint/catalog,
    // etc.) instead of hiding it behind the button label "Fail".
    let why = String(res.status);
    try {
      const t = await res.text();
      try {
        const j = JSON.parse(t);
        why = (j && (j.error && j.error.message)) || (j && j.message) || why;
      } catch {
        if (t) why = t;
      }
    } catch {}
    if (String(why) === String(res.status)) why = "HTTP " + res.status;
    throw new Error(why);
  } catch (e) {
    setDot(pid, "bad");
    btn.textContent = "Fail";
    btn.className = "btn-test err";
    // 'Failed to fetch' / 'NetworkError' => the browser never got an HTTP answer
    // (CORS or connectivity), which is a different problem from a key rejection.
    logRot(`${REG[pid].name} key test failed (${e.message})`, "err");
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
