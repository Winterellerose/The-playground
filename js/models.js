"use strict";
/* ═══ models.js — model picker + custom models ═══ */

/* Provider the custom-model form was last used with, so adding a second NVIDIA
   model doesn't mean picking NVIDIA out of the dropdown all over again (and so
   it doesn't silently default back to OpenRouter either). */
const CUSTOM_PROV_KEY = "pg_custom_prov";
function lastCustomProv() {
  let p = "";
  try {
    p = localStorage.getItem(CUSTOM_PROV_KEY) || "";
  } catch {}
  return REG[p] ? p : "openrouter";
}

/* ── Custom-model enrichment ──────────────────────────────────────
   A hand-added model only knows its provider + apiId. Everything
   else (context window, vision, thinking, params, pricing) lives in
   the catalogs — curated entries, the cached OpenRouter/native model
   lists, and the live or:/nat: picker rows. findMetaInCatalogs()
   digs that metadata out so custom cards stop showing ctx "—" with
   no tags, and enrichCustomModelsFromCatalogs() re-runs the lookup
   after every catalog refresh so saved customs upgrade in place. */
function catalogMetaOf(m) {
  return {
    name: m.name,
    ctx: m.ctx,
    vision: m.vision,
    thinking: m.thinking,
    adaptive: m.adaptive,
    intel: m.intel,
    params: m.params,
    desc: m.desc,
    pricing: m.pricing || null,
  };
}
function findMetaInCatalogs(prov, apiId) {
  // Search order: exact id among registered models (curated + live
  // or:/nat: rows), bare/suffix match there, OpenRouter cache, this
  // provider's native cache, then every native cache.
  const orProv = prov === "openrouter" || prov === "openrouter_paid";
  const sameFam = (m) =>
    orProv
      ? m.provider === "openrouter" || m.provider === "openrouter_paid"
      : m.provider === prov;
  const bare = String(apiId).split("/").pop().toLowerCase();
  let hit = Object.values(MODELS).find(
    (m) => !m.custom && m.apiId === apiId && sameFam(m),
  );
  // Bare/suffix match ("anthropic/claude-sonnet-5" ↔ curated
  // "claude-sonnet-5"): prefer the same provider family, then accept a
  // cross-family entry when at least one side is a bare id — the metadata
  // describes the same underlying model whichever host serves it. Both
  // sides vendor-prefixed means host-specific ids, so those never cross.
  if (!hit)
    hit = Object.values(MODELS).find(
      (m) =>
        !m.custom &&
        m.apiId &&
        m.apiId.split("/").pop().toLowerCase() === bare &&
        sameFam(m),
    );
  if (!hit)
    hit = Object.values(MODELS).find(
      (m) =>
        !m.custom &&
        m.apiId &&
        m.apiId.split("/").pop().toLowerCase() === bare &&
        (!String(apiId).includes("/") || !m.apiId.includes("/")),
    );
  if (hit) {
    const meta = catalogMetaOf(hit);
    // Curated entries carry hand-written metadata but no pricing; the
    // OpenRouter cache does. Top the hit up so the cost meter works.
    if (!meta.pricing && orProv) {
      try {
        const c = JSON.parse(localStorage.getItem(OR_CAT_KEY) || "null");
        const mo =
          c && Array.isArray(c.models)
            ? c.models.find((m) => m.id === apiId)
            : null;
        if (mo && mo.pricing) meta.pricing = mo.pricing;
      } catch {}
    }
    return meta;
  }
  if (orProv) {
    try {
      const c = JSON.parse(localStorage.getItem(OR_CAT_KEY) || "null");
      const mo =
        c && Array.isArray(c.models)
          ? c.models.find((m) => m.id === apiId)
          : null;
      if (mo)
        return {
          name: mo.name,
          ctx: fmtCtx(mo.ctx || 0),
          vision: !!mo.vision,
          desc: mo.desc,
          pricing: mo.pricing || null,
        };
    } catch {}
  }
  const fromNativeList = (list) => {
    if (!Array.isArray(list) || !list.length) return null;
    const mo =
      list.find((m) => m.id === apiId) ||
      list.find((m) => m.id && m.id.split("/").pop().toLowerCase() === bare);
    return mo
      ? {
          name: mo.name,
          ctx: fmtCtx(mo.ctx || 0),
          vision: !!mo.vision,
          desc: mo.desc,
        }
      : null;
  };
  try {
    const c = JSON.parse(localStorage.getItem(NATIVE_CAT_KEY) || "null");
    const byPid = (c && c.byPid) || {};
    if (!orProv) {
      const meta = fromNativeList(byPid[prov] && byPid[prov].models);
      if (meta) return meta;
    }
    for (const pid of Object.keys(byPid)) {
      const meta = fromNativeList(byPid[pid] && byPid[pid].models);
      if (meta) return meta;
    }
  } catch {}
  return null;
}
function inferVisionFromId(apiId) {
  // Strong signals only — a wrong "vision" promise breaks image sends.
  return /vision|multimodal|_vl\b|-vl\b|\/vl\b|llava|pixtral/i.test(
    String(apiId || ""),
  );
}
function inferThinkingFromId(apiId, desc) {
  const id = String(apiId || "").toLowerCase();
  if (/thinking|reason(er|ing)/i.test(id + " " + String(desc || "")))
    return true;
  return /deepseek-r1|deepseek-v4|qwq|\bo1\b|\bo3\b|\bo4\b|glm-5|gemini-3|claude-5/.test(
    id,
  );
}
function inferAdaptiveFromId(apiId) {
  // Models whose reasoning is always on / self-budgeted — the toggle
  // renders on + disabled for these, same as the curated entries.
  return /claude-(opus|sonnet|haiku|fable)-5|opus-4-8|gpt-5\.5|gemini-3\.8-flash|glm-5\.3/i.test(
    String(apiId || ""),
  );
}
function mergeFlag(saved, catalog, inferred) {
  // true beats false beats unknown: enrichment only ever upgrades a
  // stale save when better info arrives, it never downgrades a true.
  if (saved === true || catalog === true || inferred === true) return true;
  if (saved === false || catalog === false) return false;
  return undefined;
}
function enrichCustomModelEntry(cm) {
  const meta = findMetaInCatalogs(cm.provider, cm.apiId) || {};
  if (typeof cm.ctx === "number") cm.ctx = fmtCtx(cm.ctx);
  if (meta.ctx && meta.ctx !== "—") cm.ctx = meta.ctx;
  if (!cm.ctx) cm.ctx = "—";
  const catalogDesc = meta.desc || "";
  cm.vision = mergeFlag(cm.vision, meta.vision, inferVisionFromId(cm.apiId));
  cm.adaptive = mergeFlag(
    cm.adaptive,
    meta.adaptive,
    inferAdaptiveFromId(cm.apiId),
  );
  cm.thinking = mergeFlag(
    cm.thinking,
    meta.thinking,
    inferThinkingFromId(cm.apiId, catalogDesc),
  );
  if (cm.adaptive === true) cm.thinking = true; // adaptive implies thinking
  if (meta.params) cm.params = meta.params;
  if (meta.pricing) cm.pricing = meta.pricing;
  // Prefer the catalog's real description over the generated placeholder.
  if (catalogDesc && (!cm.desc || /^custom model\./i.test(cm.desc)))
    cm.desc = catalogDesc;
  // Upgrade the auto-derived display name when a catalog knows a nicer one.
  const derived =
    !cm.name ||
    cm.name === cm.apiId ||
    String(cm.apiId).split("/").pop().toLowerCase().startsWith(cm.name.toLowerCase());
  if (meta.name && derived) cm.name = String(meta.name).slice(0, 40);
  cm.intel =
    Math.max(
      cm.intel || 0,
      meta.intel || 0,
      cm.adaptive === true ? 5 : cm.thinking === true ? 4 : 0,
    ) || 3;
}
function loadCustomModels() {
  customModels.forEach((cm) => {
    if (cm && cm.id && cm.apiId && REG[cm.provider]) {
      enrichCustomModelEntry(cm); // ctx/vision/thinking/… from the catalogs
      MODELS[cm.id] = {
        name: cm.name || cm.apiId,
        badge: (cm.name || cm.apiId).slice(0, 7).toUpperCase(),
        group: "custom",
        provider: cm.provider,
        apiId: cm.apiId,
        isFree: REG[cm.provider].type === "free",
        intel: cm.intel || 3,
        ctx: cm.ctx || "—",
        vision: cm.vision === true,
        thinking: cm.thinking === true,
        adaptive: cm.adaptive === true,
        params: cm.params,
        pricing: cm.pricing || null,
        desc:
          cm.desc || "Custom model. " + REG[cm.provider].name + " · " + cm.apiId,
        custom: true,
      };
    }
  });
}
function saveCustomModels() {
  // Persist the enriched fields too, so a reload before any catalog is
  // available still shows real ctx/vision/thinking instead of blanks.
  localStorage.setItem(
    "pg_custom_models",
    JSON.stringify(
      customModels
        .filter((c) => MODELS[c.id]?.custom === true)
        .map((c) => ({
          id: c.id,
          provider: c.provider,
          apiId: c.apiId,
          name: c.name,
          ctx: c.ctx,
          vision: c.vision,
          thinking: c.thinking,
          adaptive: c.adaptive,
          intel: c.intel,
          params: c.params,
          desc: c.desc,
          pricing: c.pricing || null,
        })),
    ),
  );
}
function enrichCustomModelsFromCatalogs() {
  // Hooked after every catalog apply/refresh: customs resolve against
  // whatever the catalogs know *now*, upgrading in place over time.
  if (!customModels.length) return;
  const before = JSON.stringify(customModels);
  customModels.forEach((cm) => {
    if (cm && cm.id && cm.apiId && REG[cm.provider]) enrichCustomModelEntry(cm);
  });
  if (JSON.stringify(customModels) === before) return;
  loadCustomModels();
  saveCustomModels();
  regroupModels();
  if ($("mpOverlay")?.classList.contains("open")) renderModelPicker(true);
  if (MODELS[selectedModel]?.custom) selectModel(selectedModel, false);
}
/* Which provider actually owns this exact id, per the live lists on hand.
   The custom-model provider dropdown defaults to OpenRouter, so an NVIDIA id
   typed into the box used to be SAVED as an OpenRouter model — and then every
   request went to OpenRouter, no NVIDIA key involved. Returns null when the
   lists don't settle it, in which case the dropdown wins. */
function detectProviderForId(apiId) {
  const hits = new Set();
  try {
    const c = JSON.parse(localStorage.getItem(NATIVE_CAT_KEY) || "null");
    const byPid = (c && c.byPid) || {};
    Object.keys(byPid).forEach((pid) => {
      const l = byPid[pid] && byPid[pid].models;
      if (Array.isArray(l) && l.some((mo) => mo && mo.id === apiId)) hits.add(pid);
    });
  } catch {}
  // Curated and already-registered live rows count too — NVIDIA's /models list
  // only loads through a CORS relay, but its curated ids are known regardless.
  Object.values(MODELS).forEach((m) => {
    if (!m.custom && m.apiId === apiId && REG[m.provider]) hits.add(m.provider);
  });
  const own = [...hits].filter((p) => !OR_STYLE.includes(p));
  return own.length === 1 ? own[0] : null;
}
function customModelVerify(prov, apiId) {
  // Validate a hand-entered id against whatever live model list we have on hand.
  // Returns 'ok' | {warn} (list unavailable — allow, but say so) | {err} (known-bad id).
  const r = REG[prov] || {};
  const orProv = prov === "openrouter" || prov === "openrouter_paid";
  let ids = null,
    src = "";
  if (orProv) {
    try {
      const c = JSON.parse(localStorage.getItem(OR_CAT_KEY) || "null");
      if (c && Array.isArray(c.models) && c.models.length) {
        ids = c.models.map((m) => m.id);
        src = "the OpenRouter catalog";
      }
    } catch {}
  } else {
    try {
      const c = JSON.parse(localStorage.getItem(NATIVE_CAT_KEY) || "null");
      const l = c && c.byPid && c.byPid[prov] && c.byPid[prov].models;
      if (Array.isArray(l) && l.length) {
        ids = l.map((m) => m.id);
        src = "the " + r.name + " model list";
      }
    } catch {}
  }
  if (!ids) {
    // fall back to live entries the catalogs already registered in this session
    ids = Object.values(MODELS)
      .filter((m) => m.live && (orProv || m.provider === prov) && m.apiId)
      .map((m) => m.apiId);
    if (ids.length)
      src = orProv ? "the OpenRouter catalog" : "the " + r.name + " model list";
  }
  if (!ids || !ids.length)
    return {
      warn:
        (r.name || prov) +
        "'s model list isn't loaded yet, so this couldn't be verified — remove it with × if chats fail.",
    };
  if (ids.includes(apiId)) return "ok";
  const owner = detectProviderForId(apiId);
  return {
    err:
      '"' +
      apiId +
      "\" isn't in " +
      src +
      "." +
      (owner && owner !== prov
        ? " That id belongs to " +
          REG[owner].name +
          " — switch the provider dropdown to " +
          REG[owner].name +
          " and add it again."
        : " Check the ID (OpenRouter needs vendor/model, e.g. anthropic/claude-opus-5) and try again."),
  };
}
function addCustomModel() {
  const chosenProv = $("cmProv").value;
  let prov = chosenProv,
    idRaw = $("cmId").value.trim();
  if (!idRaw) return logRot("Custom model: enter an ID", "warn");
  if (/\s/.test(idRaw))
    return logRot("Custom model: IDs can't contain spaces", "warn");
  if (idRaw.length < 2 || idRaw.length > 120)
    return logRot("Custom model: that ID length looks wrong", "warn");
  if (!/^[\w.:/-]+$/.test(idRaw))
    return logRot(
      "Custom model: IDs may only contain letters, digits, and . - _ : /",
      "warn",
    );
  const orPair = (p) => p === "openrouter" || p === "openrouter_paid";
  // The provider dropdown defaults to OpenRouter and most people never touch
  // it, so NVIDIA/Groq/… ids used to be registered as OpenRouter models and
  // then sent to OpenRouter for the rest of their life. When a live list says
  // the id belongs to exactly one other provider — and OpenRouter's own
  // catalog does NOT list it — trust the list and say so out loud.
  const owner = detectProviderForId(idRaw);
  const corrected =
    owner && orPair(prov) && orCatalogHas(idRaw) !== true ? owner : prov;
  if (corrected !== prov) prov = corrected;
  if (customModels.some((c) => c.provider === prov && c.apiId === idRaw))
    return logRot("Custom model: you already added this one", "warn");
  const dupe = Object.values(MODELS).find(
    (m) =>
      !m.custom &&
      m.apiId === idRaw &&
      (m.provider === prov || (orPair(m.provider) && orPair(prov))),
  );
  if (dupe)
    return logRot(
      'Custom model: "' +
        idRaw +
        '" is already listed as ' +
        dupe.name +
        " — search for it instead",
      "warn",
    );
  const v = customModelVerify(prov, idRaw);
  if (v && v.err) return logRot("Custom model: " + v.err, "err");
  const id = "custom_" + Date.now();
  customModels.push({
    id,
    provider: prov,
    apiId: idRaw,
    name: idRaw.split("/").pop().slice(0, 24),
  });
  loadCustomModels();
  saveCustomModels(); // register first, THEN persist — the old order dropped the newest add
  try {
    localStorage.setItem(CUSTOM_PROV_KEY, prov); // remember the choice for next time
  } catch {}
  $("cmId").value = "";
  renderModelPicker(true);
  selectModel(id, true);
  logRot(
    v === "ok"
      ? "Custom model added: " + idRaw + " via " + REG[prov].name
      : "Custom model added (unverified): " + idRaw + " — " + v.warn,
    v === "ok" ? "ok" : "warn",
  );
  if (prov !== chosenProv)
    logRot(
      `Provider corrected to ${REG[prov].name} — that id isn't on OpenRouter, so requests won't be sent there.`,
      "warn",
    );
}
function removeCustom(id, ev) {
  if (ev) ev.stopPropagation();
  customModels = customModels.filter((c) => c.id !== id);
  delete MODELS[id];
  saveCustomModels();
  if (selectedModel === id) selectModel(pickDefaultModel());
  renderModelPicker(true);
}

/* ── Model picker ── */
function mpCardHtml(id, m) {
  const dots = Array.from(
    { length: 5 },
    (_, i) => `<span class="dot${i < m.intel ? " filled" : ""}"></span>`,
  ).join("");
  const tags = [
    m.ctx && m.ctx !== "—" ? m.ctx : null,
    m.params,
    m.vision ? "👁 vision" : null,
    m.adaptive ? "🧠 adaptive" : m.thinking ? "🧠 thinking" : null,
  ]
    .filter(Boolean)
    .map((t) => `<span class="mp-tag">${esc(t)}</span>`)
    .join("");
  const priceTag = m.isFree
    ? `<span class="mp-card-free-tag">FREE</span>`
    : `<span class="mp-card-paid-tag">PREMIUM</span>`;
  const del = m.custom
    ? `<button class="sb-del" style="opacity:1;position:static;font-size:20px;line-height:1;padding:2px 8px;align-self:center" data-act="remove-custom" data-id="${esc(id)}" title="Remove this custom model" aria-label="Remove custom model ${esc(m.name)}">×</button>`
    : "";
  return `<div class="mp-card${id === selectedModel ? " selected" : ""}" data-mid="${esc(id)}" data-name="${esc(((m.name || "") + " " + (m.apiId || "") + " " + (m.provider || "") + " " + (m.desc || "")).toLowerCase())}" tabindex="0" role="button" aria-pressed="${id === selectedModel ? "true" : "false"}"><div class="mp-card-top"><span class="mp-card-name">${esc(m.name)} ${priceTag}</span>${del}<span class="intel-dots">${dots}</span></div>${tags ? `<div class="mp-card-tags">${tags}</div>` : ""}<div class="mp-card-desc">${esc(m.desc || "")}</div></div>`;
}
function sortModels(arr) {
  // Featured first by intel, then alphabetical; selected model always on top.
  return arr.sort((a, b) => {
    if (a[0] === selectedModel) return -1;
    if (b[0] === selectedModel) return 1;
    return (
      (b[1].intel || 0) - (a[1].intel || 0) ||
      a[1].name.localeCompare(b[1].name)
    );
  });
}
let mpQuery = "";
function mpFilter(q) {
  mpQuery = (q || "").trim().toLowerCase();
  const body = $("mpBody");
  if (!body) return;
  // Show the All-models section whenever there's a query; hide the buckets otherwise.
  body.querySelectorAll(".mp-section").forEach((sec) => {
    const isSearch = sec.classList.contains("mp-search-section");
    if (mpQuery) {
      if (isSearch) {
        sec.classList.remove("collapsed");
        sec.style.display = "";
        let shown = 0;
        sec.querySelectorAll(".mp-card").forEach((c) => {
          const hit = (c.dataset.name || "").includes(mpQuery);
          c.style.display = hit ? "" : "none";
          if (hit) shown++;
        });
        const nr = sec.querySelector(".mp-noresults");
        if (nr) nr.style.display = shown ? "none" : "";
      } else {
        sec.style.display = "none";
      }
    } else {
      if (isSearch) {
        sec.style.display = "none";
      } else {
        sec.style.display = "";
        sec.querySelectorAll(".mp-card").forEach((c) => (c.style.display = ""));
      }
    }
  });
}
function mpSectionToggle(el) {
  // The search section header isn't clickable; only buckets collapse.
  const sec = el.closest(".mp-section");
  if (!sec || sec.classList.contains("mp-search-section")) return;
  sec.classList.toggle("collapsed");
  const head = sec.querySelector(".mp-section-header");
  if (head)
    head.setAttribute(
      "aria-expanded",
      sec.classList.contains("collapsed") ? "false" : "true",
    );
}
function renderModelPicker() {
  regroupModels();
  const totalAll = Object.values(MODELS).length;
  const sections = GROUPS.map((g) => {
    if (g.search) {
      // Every model is searchable — including curated/featured rows, which
      // used to vanish from results the moment you typed their name.
      const models = sortModels(Object.entries(MODELS));
      const header = `<div class="mp-section-header"><span class="mp-section-icon">${g.icon}</span><div class="mp-provider"><span class="mp-provider-name">${g.name}</span><span class="mp-provider-blurb">${g.blurb}</span></div><span class="mp-provider-count">${models.length}</span></div>`;
      return `<div class="mp-section mp-search-section" data-g="${g.id}" style="display:none">${header}<div class="mp-cards">${models.map(([id, m]) => mpCardHtml(id, m)).join("")}<div class="mp-noresults" style="display:none">No models match “${esc(mpQuery)}”.</div></div></div>`;
    }
    const models = sortModels(
      Object.entries(MODELS).filter(([, m]) => m.group === g.id),
    );
    if (!models.length) return "";
    const hasSel = models.some(([id]) => id === selectedModel);
    return `<div class="mp-section ${g.id}" data-g="${g.id}"><div class="mp-section-header" tabindex="0" role="button" aria-expanded="true" aria-label="Toggle ${esc(g.name)}"><span class="mp-section-icon">${g.icon}</span><div class="mp-provider"><span class="mp-provider-name">${g.name}</span><span class="mp-provider-blurb">${g.blurb}</span></div><span class="mp-provider-count">${models.length}</span><span class="mp-section-toggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="6 9 12 15 18 9"/></svg></span></div><div class="mp-cards">${models.map(([id, m]) => mpCardHtml(id, m)).join("")}</div></div>`;
  }).join("");
  $("mpBody").innerHTML =
    `<div class="mp-search">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
       <input id="mpSearch" placeholder="Search ${totalAll} models…" value="${esc(mpQuery)}" autocomplete="off" aria-label="Search models">
     </div>
     <div class="mp-search-hint">${Object.values(MODELS).filter((m) => m.isFree).length} free · ${Object.values(MODELS).filter((m) => !m.isFree).length} premium</div>` +
    sections +
    `<div class="mp-custom-add"><select id="cmProv" aria-label="Provider for custom model">${Object.entries(
      REG,
    )
      .map(
        ([pid, r]) =>
          `<option value="${pid}"${pid === lastCustomProv() ? " selected" : ""}>${r.name}</option>`,
      )
      .join(
        "",
      )}</select><input id="cmId" placeholder="vendor/model-id (e.g. anthropic/claude-opus-5)" spellcheck="false" aria-label="Model ID"><button class="btn-acc" data-act="add-custom">Add</button></div>` +
    `<div class="mp-custom-hint">Pick the provider that actually serves the ID — a model saved under OpenRouter is called on OpenRouter. ctx, vision and thinking auto-enrich from the live catalogs.</div>`;
  // Restore filter state and focus the search box.
  if (mpQuery) mpFilter(mpQuery);
  setTimeout(() => {
    const i = $("mpSearch");
    if (i) {
      i.focus();
      if (mpQuery) i.setSelectionRange(i.value.length, i.value.length);
    }
  }, 30);
}
function selectModel(id, close) {
  if (!MODELS[id]) return;
  selectedModel = id;
  localStorage.setItem("selected_model", id);
  const m = MODELS[id];
  $("heroModel").textContent = m.badge.toUpperCase();
  $("heroCtx").textContent = m.ctx || "—";
  $("frameMeta").textContent =
    "— " + REG[m.provider].name.toUpperCase() + " · " + m.badge.toUpperCase();
  $("welcomeModel").textContent = m.name;
  const tog = $("thinkingToggle");
  if (m.adaptive) {
    tog.classList.add("on", "disabled");
  } else if (m.thinking === true) {
    tog.classList.remove("disabled");
  } else {
    tog.classList.remove("on", "disabled");
  } // models without manual thinking: toggle off + locked-looking off
  syncToggle(tog);
  updateUsageMeter();
  const pill = $("statusPill");
  pill.className = "status-pill " + (m.isFree ? "free" : "paid");
  pill.innerHTML = `<span class="dot"></span>${m.isFree ? "Free" : "Paid"}`;
  setAttachUI();
  // Say it at pick time, not after a failed send: a model whose provider this
  // page can't reach (NVIDIA NIM without a CORS relay, a missing key) used to
  // look perfectly usable until the request failed — or quietly left for
  // OpenRouter and came back with a 402 credit wall. getCfg() logs the
  // substitution itself when a legitimate fallback exists.
  const probe = getCfg();
  if (probe.error) logRot(`${m.name}: ${probe.error}`, "warn");
  if (close) closeModelPicker();
}
function syncToggle(t) {
  if (!t) return;
  t.setAttribute("aria-checked", t.classList.contains("on") ? "true" : "false");
  if (t.classList.contains("disabled")) t.setAttribute("aria-disabled", "true");
  else t.removeAttribute("aria-disabled");
}
function toggleThinking() {
  const t = $("thinkingToggle");
  if (!t) return;
  if (t.classList.contains("disabled")) return;
  t.classList.toggle("on");
  syncToggle(t);
}
function updateUsageMeter() {
  const c=getActiveChat(), m=MODELS[selectedModel]||{}, ctx=parseCtx(m.ctx);
  const used=(c?.messages||[]).reduce((n,x)=>n+(x.meta&&Number(x.meta.in)+Number(x.meta.out)||Math.ceil(String(x.content||'').length/4)),0);
  // Live catalog entries carry per-token pricing; estimate from the model each
  // answer actually used (rotation may differ from the selected one). Curated
  // entries have no pricing data, so those chats show no $ tag instead of a fake one.
  const cost=(c?.messages||[]).reduce((n,x)=>{ const pr=x.meta&&x.meta.m&&(Object.values(MODELS).find(v=>v.apiId===x.meta.m&&v.pricing)||{}).pricing; return pr?n+(Number(x.meta.in)||0)*(parseFloat(pr.prompt)||0)+(Number(x.meta.out)||0)*(parseFloat(pr.completion)||0):n; },0);
  // Truth in advertising: the header names the provider that will ACTUALLY
  // answer. A model registered under NVIDIA NIM that ends up routed elsewhere
  // used to keep saying "NVIDIA NIM" while the request went to OpenRouter.
  const via=m.provider&&REG[m.provider]?servingPid(m):null;
  const rp=REG[via||m.provider]||{};
  const prov=via&&via!==m.provider
    ? REG[m.provider].name.toUpperCase()+" → "+REG[via].name.toUpperCase()
    : (REG[m.provider]?.name?.toUpperCase()||"");
  const tag=cost>0?" · ~$"+(cost<0.01?cost.toFixed(4):cost.toFixed(2)):rp.type === "free" || rp.local ? " · free" : "";
  const el=$("frameMeta"); if(el) el.textContent="— "+prov+" · "+m.badge?.toUpperCase()+" · "+(ctx?Math.round(used/1000)+"k / "+Math.round(ctx/1000)+"k":"est. —")+tag;
}
