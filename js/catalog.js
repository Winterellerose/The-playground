"use strict";
/* ═══ catalog.js — live model catalogs (OpenRouter + native) ═══ */

/* ── OpenRouter live catalog (auto-fetch · hourly cache) ── */
const OR_CAT_KEY = "pg_or_catalog_v1",
  OR_CAT_TTL = 3600e3;
function applyCatalog(list) {
  const curated = new Set(
    Object.values(MODELS)
      .filter((m) => !m.live)
      .map((m) => m.apiId),
  ); // built-ins + customs win
  const selBackup =
    MODELS[selectedModel] && MODELS[selectedModel].live
      ? MODELS[selectedModel]
      : null; // never strand the selection
  // Index the real catalog by id so we can reconcile hand-written entries against it.
  const realMap = new Map();
  list.forEach((mo) => realMap.set(mo.id, mo));
  Object.keys(MODELS).forEach((k) => {
    if (MODELS[k].live) delete MODELS[k];
  });
  list.forEach((mo) => {
    if (curated.has(mo.id)) return;
    MODELS["or:" + mo.id] = {
      name: mo.name,
      badge: mo.name.slice(0, 9).toUpperCase(),
      group: "search",
      provider: mo.free ? "openrouter" : "openrouter_paid",
      apiId: mo.id,
      isFree: mo.free,
      intel: mo.free ? 3 : 4,
      ctx: fmtCtx(mo.ctx || 0),
      vision: mo.vision,
      live: true,
      pricing: mo.pricing,
      desc:
        (mo.desc || "").replace(/\s+/g, " ").trim().slice(0, 150) ||
        "Live entry from the OpenRouter catalog.",
    };
  });
  // ── Reconcile curated entries against the live catalog (source of truth) ──
  // Fixes stale isFree flags (paid models marked free) and removes OpenRouter-
  // hosted IDs that no longer exist. Native-provider entries (Groq, Cerebras,
  // Gemini, …) are kept as-is but corrected when they're cross-listed here.
  const isFreeOf = (mo) => {
    if (typeof mo.free === "boolean") return mo.free;
    const p = mo.pricing || {};
    return parseFloat(p.prompt) === 0 && parseFloat(p.completion) === 0;
  };
  const visionOf = (mo) => {
    if (typeof mo.vision === "boolean") return mo.vision;
    return (
      Array.isArray(mo.architecture && mo.architecture.input_modalities) &&
      mo.architecture.input_modalities.includes("image")
    );
  };
  const ghosts = [];
  Object.entries(MODELS).forEach(([k, m]) => {
    if (m.live || m.custom) return;
    const onOR =
      m.provider === "openrouter" || m.provider === "openrouter_paid";
    const real = realMap.get(m.apiId);
    if (real) {
      // Price is a property of the HOST, not of the model. OpenRouter charging
      // for `meta/llama-3.3-70b-instruct` says nothing about what NVIDIA
      // charges for it, so only OpenRouter-served entries are re-priced —
      // otherwise a cross-listed native model flips to "paid", stops being
      // offered its free fallbacks, and the picker lies about the cost.
      if (onOR) m.isFree = isFreeOf(real);
      const realCtx = real.ctx || real.context_length;
      if (realCtx) m.ctx = fmtCtx(realCtx);
      if (
        typeof real.vision === "boolean" ||
        (real.architecture && real.architecture.input_modalities)
      )
        m.vision = visionOf(real);
      m.verified = true;
    } else if (onOR && !m.apiId.startsWith("~")) {
      ghosts.push(k); // hand-written OpenRouter id not in catalog → drop it
    }
  });
  ghosts.forEach((k) => delete MODELS[k]);
  if (selBackup && !MODELS[selectedModel]) MODELS[selectedModel] = selBackup;
  // If the selected model was a removed ghost, fall back to a known-good model
  // AND repaint the hero. Just reassigning selectedModel left the header
  // advertising the dead model — badge, context and the Free/Paid pill went
  // stale until the user picked something by hand.
  const stranded = !MODELS[selectedModel];
  if (stranded) {
    selectedModel = pickDefaultModel();
    localStorage.setItem("selected_model", selectedModel);
  }
  regroupModels();
  if (stranded && MODELS[selectedModel]) selectModel(selectedModel, false);
  // The catalog just changed — customs may now resolve ids they couldn't
  // before. Guarded typeof: models.js isn't part of the test bundle.
  if (typeof enrichCustomModelsFromCatalogs === "function")
    enrichCustomModelsFromCatalogs();
}
async function refreshCatalog(force) {
  let c = null;
  try {
    c = JSON.parse(localStorage.getItem(OR_CAT_KEY) || "null");
  } catch {}
  const fresh = !!(c && c.ts && Date.now() - c.ts < OR_CAT_TTL);
  if (c && Array.isArray(c.models) && c.models.length) {
    applyCatalog(c.models);
    logRot(
      `Catalog: ${c.models.length} OpenRouter models (${fresh ? "cache fresh" : "cache stale → refreshing"})`,
    );
    if (fresh && !force) return;
  }
  try {
    const res = await fetch(REG.openrouter.models); // public endpoint, no key needed
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    const models = (Array.isArray(j.data) ? j.data : [])
      .map((x) => ({
        id: x.id,
        name: (x.name || x.id).split("/").pop(),
        ctx: x.context_length || 0,
        free:
          x.id.endsWith(":free") ||
          (parseFloat(x.pricing && x.pricing.prompt) === 0 &&
            parseFloat(x.pricing && x.pricing.completion) === 0),
        vision: (
          (x.architecture && x.architecture.input_modalities) ||
          []
        ).includes("image"),
        desc: x.description || "",
        pricing: x.pricing || null,
      }))
      .filter((m) => m.id);
    if (!models.length) throw new Error("empty catalog");
    try {
      localStorage.setItem(
        OR_CAT_KEY,
        JSON.stringify({ ts: Date.now(), models }),
      );
    } catch {}
    applyCatalog(models);
    logRot(`Catalog refreshed: ${models.length} live OpenRouter models`, "ok");
    if ($("mpOverlay").classList.contains("open")) renderModelPicker(true);
  } catch (e) {
    logRot("Catalog refresh failed — serving cached list", "warn");
  }
}

/* ── Native provider model lists (auto-update, like OpenRouter) ──
   Each provider with a public /models endpoint is fetched using the user's
   stored API key. Newly discovered models go into the "All models" search
   group and curated IDs get verified, so every provider self-corrects on
   load and hourly — no manual edits required. */
const NATIVE_CAT_TTL = 3600e3,
  NATIVE_CAT_KEY = "pg_native_catalog_v1";
/* Which ids from a provider's own /models list may enter the picker.
   Most native APIs use bare ids and vendor/-prefixed ones are OpenRouter's
   noise — but not all of them: NVIDIA (namespaced in REG) only ever returns
   `meta/llama-3.3-70b-instruct`-style ids, so the old blanket slash filter
   silently discarded NVIDIA's entire catalog. */
function nativeIdUsable(pid, id) {
  const r = REG[pid] || {};
  if (!String(id || "").includes("/")) return true;
  return pid === "openrouter" || pid === "openrouter_paid" || !!r.namespaced;
}
function parseNativeModels(pid, data) {
  let arr = Array.isArray(data) ? data : data.data || data.models || [];
  const out = [];
  for (const x of arr) {
    if (!x || !x.id) continue;
    const id = String(x.id);
    // Skip non-chat models (embeddings, audio, rerank, image/video gen, STT).
    if (
      /(embed|rerank|tts|whisper|stt|asr|speech|transcri|audio|image-gen|flux|seedream|seedance|imagen|video|dall-e)/i.test(
        id,
      )
    )
      continue;
    const name = (x.name || id.split("/").pop())
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const ctx =
      x.context_length ||
      x.max_context_length ||
      x.context_window ||
      x.context_window_tokens ||
      0;
    const vision =
      /vision|multimodal|vl\b/i.test(id) ||
      !!(x.capabilities && x.capabilities.vision) ||
      !!x.supports_vision;
    let free = REG[pid].type === "free";
    if (x.pricing)
      free =
        parseFloat(x.pricing.prompt) === 0 &&
        parseFloat(x.pricing.completion) === 0;
    out.push({ id, name, ctx, free, vision, desc: x.description || "" });
  }
  return out;
}
function applyNativeCatalog(pid, list) {
  if (!Array.isArray(list) || !list.length) return;
  const r = REG[pid];
  const known = new Set(Object.values(MODELS).map((m) => m.apiId));
  let added = 0;
  for (const mo of list) {
    if (!mo.id || known.has(mo.id)) continue;
    if (!nativeIdUsable(pid, mo.id)) continue;
    const k = "nat:" + pid + ":" + mo.id;
    if (MODELS[k]) continue;
    MODELS[k] = {
      name: mo.name,
      badge: mo.name.slice(0, 9).toUpperCase(),
      group: "search",
      provider: pid,
      apiId: mo.id,
      isFree: r.type === "free" && mo.free !== false,
      intel: 3,
      ctx: fmtCtx(mo.ctx || (r.local ? 8192 : 0)),
      vision: !!mo.vision,
      live: true,
      native: true,
      desc: (mo.desc || r.name + " model").slice(0, 150),
    };
    added++;
  }
  const idset = new Set(list.filter((x) => nativeIdUsable(pid, x.id)).map((x) => x.id));
  Object.values(MODELS).forEach((m) => {
    if (m.provider === pid && !m.live && idset.has(m.apiId)) m.verified = true;
  });
  if (added) {
    logRot(
      `${r.name}: added ${added} model${added > 1 ? "s" : ""} from live API`,
      "ok",
    );
    regroupModels();
  }
  // New native rows may unlock metadata for saved custom models.
  if (typeof enrichCustomModelsFromCatalogs === "function")
    enrichCustomModelsFromCatalogs();
}
async function refreshNativeCatalogs() {
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(NATIVE_CAT_KEY) || "null");
  } catch {}
  const freshAll = !!(
    cached &&
    cached.ts &&
    Date.now() - cached.ts < NATIVE_CAT_TTL
  );
  const results = (cached && cached.byPid) || {};
  const jobs = Object.keys(REG).map(async (pid) => {
    const r = REG[pid];
    if (!r.models || pid === "openrouter" || pid === "openrouter_paid") return;
    // A provider with no CORS headers can only be reached through a relay;
    // without one, the request would just die in the console as "Failed to fetch".
    if (relayNeeded(pid)) return;
    if (freshAll && results[pid] && Array.isArray(results[pid].models)) {
      applyNativeCatalog(pid, results[pid].models);
      return;
    }
    const key = getKey(pid);
    if (!key && !r.local) return;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 8000);
    try {
      const headers = { "Content-Type": "application/json" };
      if (pid === "anthropic") {
        headers["x-api-key"] = key;
        headers["anthropic-version"] = "2023-06-01";
      } else if (!r.local) headers["Authorization"] = "Bearer " + key;
      const res = await fetch(relayUrl(pid, r.models), { headers, signal: ac.signal });
      if (!res.ok) return;
      const data = await res.json();
      const models = parseNativeModels(pid, data);
      if (models.length) {
        results[pid] = { ts: Date.now(), models };
        applyNativeCatalog(pid, models);
      }
    } catch {
      /* CORS/auth/network — silently skip; curated list still works */
    } finally {
      clearTimeout(to);
    }
  });
  await Promise.allSettled(jobs);
  try {
    localStorage.setItem(
      NATIVE_CAT_KEY,
      JSON.stringify({ ts: Date.now(), byPid: results }),
    );
  } catch {}
  // Final pass: pick up anything the per-provider applies above missed.
  if (typeof enrichCustomModelsFromCatalogs === "function")
    enrichCustomModelsFromCatalogs();
}
