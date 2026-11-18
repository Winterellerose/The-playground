'use strict';
/* ═══ rotation.js — provider rotation, backoff, getCfg ═══ */

/* ── Rotation engine ── */
function logRot(msg, type = 'evt') {
  const log = $('rotLog');
  if (!log) return;
  const now = new Date(),
    t = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  const e = document.createElement('div');
  e.className = 'rot-entry';
  e.innerHTML = `<span class="rot-time">${t}</span><span class="rot-evt ${type}">${esc(msg)}</span>`;
  log.appendChild(e);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 25) log.removeChild(log.firstChild);
}
function avail(pid) {
  // A provider whose API sends no CORS headers is unreachable from this page
  // unless a relay is configured — that's an availability fact, not a
  // rate-limit, so it's checked before anything else.
  if (relayNeeded(pid)) return false;
  const s = rotState[pid];
  if (!s) return true;
  if (s.bad) return false;
  if (s.backoffUntil && Date.now() < s.backoffUntil) return false;
  return true;
}
function markRateLimited(pid) {
  const s = (rotState[pid] = rotState[pid] || { errors: 0 });
  s.errors = (s.errors || 0) + 1;
  const sec = Math.min(30 * Math.pow(2, s.errors - 1), 120);
  s.backoffUntil = Date.now() + sec * 1000;
  logRot(`${REG[pid].name} rate-limited → backing off ${sec}s`, 'warn');
}
function markBadKey(pid) {
  rotState[pid] = { ...(rotState[pid] || {}), bad: true };
  refreshKeyUI();
  logRot(`${REG[pid].name}: key rejected (401/403) — fix it in Settings`, 'err');
}
function markOk(pid) {
  const s = rotState[pid];
  if (s) {
    s.errors = 0;
    s.backoffUntil = 0;
  }
}
const OR_STYLE = ['openrouter', 'openrouter_paid'];
const OR_HOSTABLE = /^[a-z0-9~-][a-z0-9._~-]*\/[a-z0-9._~-]+$/i;
function orHosts(id) {
  // OpenRouter can only proxy an id it actually lists. The vendor/model shape
  // heuristic is a decent guess, but when the live catalog is on hand use it:
  // NVIDIA-native ids (meta/llama-3.3-70b-instruct) have the right shape and
  // would otherwise cost a guaranteed 404 round trip on every fallback.
  try {
    const c = JSON.parse(localStorage.getItem(OR_CAT_KEY) || 'null');
    if (c && Array.isArray(c.models) && c.models.length) return c.models.some(mo => mo.id === id);
  } catch {}
  return OR_HOSTABLE.test(id);
}
function canServe(pid, m) {
  if (pid === m.provider) return true;
  if (OR_STYLE.includes(pid) && orHosts(m.apiId)) return true;
  return false;
}
/* Is this id FREE *on OpenRouter*? Both OpenRouter entries share one endpoint
   and one account balance, so "openrouter" vs "openrouter_paid" says which key
   is used — not whether the request costs credits. Only the id does: `:free`
   suffixes, or the live catalog's own pricing. Unknown is treated as paid,
   because promising free and returning 402 is the worse failure. */
function orIsFree(id) {
  if (/:free$/i.test(String(id || ''))) return true;
  try {
    const c = JSON.parse(localStorage.getItem(OR_CAT_KEY) || 'null');
    const mo = c && Array.isArray(c.models) ? c.models.find(x => x.id === id) : null;
    if (mo) return mo.free === true;
  } catch {}
  return false;
}
/* Exact OpenRouter catalog membership, without orHosts()'s id-shape guess.
   Returns null when no catalog is loaded — callers must treat "unknown" as
   unknown rather than as "not on OpenRouter". */
function orCatalogHas(id) {
  try {
    const c = JSON.parse(localStorage.getItem(OR_CAT_KEY) || 'null');
    if (c && Array.isArray(c.models) && c.models.length) return c.models.some(mo => mo.id === id);
  } catch {}
  return null;
}
/* The 402 copy, provider-accurate. It used to blame OpenRouter no matter which
   provider sent the 402 — which is how a custom NVIDIA model that had quietly
   been re-routed told its user to "pick a FREE model" on a service they had
   never chosen. */
function creditWallMessage(pid, modelId) {
  return OR_STYLE.includes(pid)
    ? `OpenRouter has no credits for "${modelId}" — that id is metered there. Pick a model marked FREE, or add credits at openrouter.ai. (Web search itself is free.)`
    : `${(REG[pid] || {}).name || pid} rejected "${modelId}" with 402 — that account is out of credits/quota.`;
}
/* canServe() answers "could this provider answer the request at all".
   substituteOk() answers "may we quietly use it instead of the model's own
   provider". A model the picker labels FREE must never be re-routed onto a
   metered route — that is exactly how a custom NVIDIA model turned into
   "that model needs OpenRouter credits": NVIDIA was unreachable, OpenRouter
   happened to list the same id as a paid model, and the request went there
   anyway. Refuse the substitution and explain instead. */
function substituteOk(pid, m) {
  if (pid === m.provider) return true;
  if (!canServe(pid, m)) return false;
  if (!m.isFree) return true; // paid models may route anywhere they're hosted
  if (OR_STYLE.includes(pid)) return orIsFree(m.apiId);
  return REG[pid].type === 'free';
}
/* Why the model's OWN provider isn't usable — the sentence the user actually
   needs, instead of a request sent somewhere else to fail. */
function providerBlockNote(m) {
  const p = m.provider,
    r = REG[p] || {};
  if (!r.name || r.local) return '';
  if (relayNeeded(p))
    return `${r.name} sends no CORS headers, so this page can only reach it through a local relay — add one in Settings → ${r.name} → CORS relay`;
  const s = rotState[p];
  if (s && s.bad) return `${r.name} rejected its API key — re-test it in Settings`;
  if (!getKey(p)) return `add your ${r.name} key in Settings`;
  if (s && s.backoffUntil && Date.now() < s.backoffUntil) return `${r.name} is rate-limited right now`;
  return '';
}
function idFor(pid, m) {
  if (pid === m.provider) return m.apiId;
  if (OR_STYLE.includes(pid) && orHosts(m.apiId)) return m.apiId;
  return FALLBACK_ID[pid] || m.apiId;
}
/* Every provider that may serve this exact model, best first. Shared by
   getCfg() (chat) and servingPid() (what the header advertises), so the UI
   can never claim a provider the request won't actually use. */
function candidatesFor(m, excludedPids = []) {
  const pool = REG[m.provider].type === 'free' ? FREE_PIDS : PAID_PIDS;
  const excluded = new Set(excludedPids || []);
  const cands = [];
  const push = pid => {
    if (
      !excluded.has(pid) &&
      !cands.includes(pid) &&
      (REG[pid].local || getKey(pid)) &&
      avail(pid) &&
      substituteOk(pid, m)
    )
      cands.push(pid);
  };
  push(m.provider);
  if (!REG[m.provider].local) OR_STYLE.forEach(push); // same exact id via OpenRouter
  if (!REG[m.provider].local) pool.forEach(push); // provider-native fallback models
  if (!REG[m.provider].local) [...PAID_PIDS, ...FREE_PIDS].filter(p => !REG[p].local).forEach(push); // last resort
  return cands;
}
/* Which provider will actually answer, or null. Logging-free on purpose: it's
   called on every header repaint. */
function servingPid(m) {
  const c = candidatesFor(m);
  return c.length ? c[0] : null;
}
function getCfg(excludedPids = []) {
  const m = MODELS[selectedModel];
  if (!m) return { error: 'Select a model.' };
  const excluded = new Set(excludedPids || []);
  const cands = candidatesFor(m, excludedPids);
  if (!cands.length) {
    // There ARE providers for this model, but every key is missing/bad/limited
    // — or the only route left would cost credits the user didn't agree to.
    const haveKey = KEY_DEFS.some(([pid]) => getKey(pid)) || Object.values(REG).some(r => r.local);
    if (!haveKey)
      return {
        error: 'No API keys configured. Open Settings and add at least one free key (OpenRouter recommended).',
      };
    const own = providerBlockNote(m);
    // A metered provider that COULD have served the exact id, which we refused
    // on purpose because the model is free. Name it rather than letting the
    // request fail with a bare 402.
    const paidRoute = OR_STYLE.find(
      p => !excluded.has(p) && REG[p].type !== 'free' && getKey(p) && avail(p) && canServe(p, m)
    );
    // Only claim this when the catalog actually says so: orHosts() falls back
    // to an id-shape guess, and "OpenRouter would charge you" is not something
    // to assert on a guess.
    const orPaidId =
      !paidRoute &&
      m.isFree &&
      orCatalogHas(m.apiId) === true &&
      !orIsFree(m.apiId) &&
      OR_STYLE.find(p => !excluded.has(p) && getKey(p) && avail(p));
    if (m.isFree && (paidRoute || orPaidId))
      return {
        error: `"${m.name}" is a FREE ${REG[m.provider].name} model, so it was NOT re-routed to OpenRouter — that route bills credits and answers 402 when the account has none. ${
          own ? 'Fix: ' + own + '.' : ''
        } Or pick a model marked PREMIUM if you mean to spend credits.`,
      };
    if (own)
      return {
        error: `"${m.name}" is served by ${REG[m.provider].name} — ${own}.`,
      };
    const canHost = Object.keys(REG).filter(p => canServe(p, m));
    const missing = canHost.filter(p => !REG[p].local && !getKey(p));
    if (missing.length)
      return {
        error: `"${m.name}" needs ${missing.map(p => REG[p].name).join(' or ')} — add that key in Settings, or pick a model you have a key for.`,
      };
    return {
      error: `All providers for "${m.name}" are rate-limited or rejected the request. Free tiers can be busy — wait a moment, pick another free model, or add a paid key.`,
    };
  }
  const pid = cands[0],
    prov = REG[pid];
  if (pid !== m.provider)
    logRot(
      `${m.badge || m.apiId}: ${REG[m.provider].name} not used — routing via ${prov.name} → ${idFor(pid, m)}`,
      prov.type === 'free' ? 'ok' : 'warn'
    );
  return {
    model: m,
    pid,
    modelId: idFor(pid, m),
    apiKey: REG[pid].local ? '' : getKey(pid),
    thinking: $('thinkingToggle').classList.contains('on'),
    effort: $('effortSelect').value,
    temp: parseFloat($('tempSelect').value),
    maxTok: Math.max(256, parseInt($('maxTok').value) || 8192),
    sys: $('sysPrompt').value.trim(),
    chatSys: chatSysText(),
    webSearch: webSearchMode,
  };
}
