"use strict";
/* ═══ models.js — model picker + custom models ═══ */

function loadCustomModels() {
  customModels.forEach((cm) => {
    if (cm && cm.id && cm.apiId && REG[cm.provider]) {
      MODELS[cm.id] = {
        name: cm.name || cm.apiId,
        badge: (cm.name || cm.apiId).slice(0, 7).toUpperCase(),
        group: "custom",
        provider: cm.provider,
        apiId: cm.apiId,
        isFree: REG[cm.provider].type === "free",
        intel: 3,
        ctx: cm.ctx || "—",
        desc: "Custom model. " + REG[cm.provider].name + " · " + cm.apiId,
        custom: true,
      };
    }
  });
}
function saveCustomModels() {
  localStorage.setItem(
    "pg_custom_models",
    JSON.stringify(customModels.filter((c) => MODELS[c.id]?.custom === true)),
  );
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
  return {
    err:
      '"' +
      apiId +
      "\" isn't in " +
      src +
      ". Check the ID (OpenRouter needs vendor/model, e.g. anthropic/claude-opus-5) and try again.",
  };
}
function addCustomModel() {
  const prov = $("cmProv").value,
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
  if (customModels.some((c) => c.provider === prov && c.apiId === idRaw))
    return logRot("Custom model: you already added this one", "warn");
  const orPair = (p) => p === "openrouter" || p === "openrouter_paid";
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
  $("cmId").value = "";
  renderModelPicker(true);
  selectModel(id, true);
  logRot(
    v === "ok"
      ? "Custom model added: " + idRaw + " via " + REG[prov].name
      : "Custom model added (unverified): " + idRaw + " — " + v.warn,
    v === "ok" ? "ok" : "warn",
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
  ]
    .filter(Boolean)
    .map((t) => `<span class="mp-tag">${t}</span>`)
    .join("");
  const priceTag = m.isFree
    ? `<span class="mp-card-free-tag">FREE</span>`
    : `<span class="mp-card-paid-tag">PREMIUM</span>`;
  const del = m.custom
    ? `<button class="sb-del" style="opacity:1;position:static;font-size:20px;line-height:1;padding:2px 8px;align-self:center" data-act="remove-custom" data-id="${esc(id)}" title="Remove this custom model" aria-label="Remove custom model ${esc(m.name)}">×</button>`
    : "";
  return `<div class="mp-card${id === selectedModel ? " selected" : ""}" data-mid="${id}" data-name="${esc(((m.name || "") + " " + (m.apiId || "") + " " + (m.provider || "")).toLowerCase())}" tabindex="0" role="button" aria-pressed="${id === selectedModel ? "true" : "false"}"><div class="mp-card-top"><span class="mp-card-name">${esc(m.name)} ${priceTag}</span>${del}<span class="intel-dots">${dots}</span></div>${tags ? `<div class="mp-card-tags">${tags}</div>` : ""}<div class="mp-card-desc">${esc(m.desc || "")}</div></div>`;
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
      // Customs are included here on purpose: anything you added must be
      // findable by search — otherwise a bad add can't be located and removed.
      const models = sortModels(
        Object.entries(MODELS).filter(
          ([, m]) => m.group === "search" || m.live || m.custom,
        ),
      );
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
          `<option value="${pid}"${pid === "openrouter" ? " selected" : ""}>${r.name}</option>`,
      )
      .join(
        "",
      )}</select><input id="cmId" placeholder="vendor/model-id (e.g. anthropic/claude-opus-5)" spellcheck="false" aria-label="Model ID"><button class="btn-acc" data-act="add-custom">Add</button></div>`;
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
  const pill = $("statusPill");
  pill.className = "status-pill " + (m.isFree ? "free" : "paid");
  pill.innerHTML = `<span class="dot"></span>${m.isFree ? "Free" : "Paid"}`;
  setAttachUI();
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
