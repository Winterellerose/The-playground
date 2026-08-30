"use strict";
/* ═══ extras.js — smart titles + follow-up chips ═══ */

/* ── Smart extras: one cheap non-streaming call → 5-word title + 3 follow-up chips ── */
function getExtrasMode() {
  return localStorage.getItem("pg_extras_mode") || "free";
}
function metaCandidates(m, mode = getExtrasMode()) {
  if (!m || mode === "off") return [];
  const pool = REG[m.provider].type === "free" ? FREE_PIDS : PAID_PIDS;
  let out = [];
  const push = (pid) => {
    const freeAllowed =
      mode === "always" ||
      (m.isFree && REG[pid].type === "free" && !REG[pid].metered);
    if (
      freeAllowed &&
      !out.includes(pid) &&
      getKey(pid) &&
      avail(pid) &&
      canServe(pid, m)
    )
      out.push(pid);
  };
  push(m.provider);
  OR_STYLE.forEach(push);
  pool.forEach(push);
  [...PAID_PIDS, ...FREE_PIDS].forEach(push);
  return out;
}
// Single non-streaming completion with provider rotation. Kept cheap: max 280 tokens,
// thinking disabled, temperature 0.4. Parses JSON out of the tail of whatever comes back.
async function metaChat(messages, m, mode = getExtrasMode()) {
  if (!m) return null;
  const body0 = { messages, stream: false, max_tokens: 280, temperature: 0.4 };
  for (const pid of metaCandidates(m, mode)) {
    try {
      const st = REG[pid].style,
        modelId = idFor(pid, m);
      let h = { "Content-Type": "application/json" },
        body = { ...body0, model: modelId };
      if (st === "anthropic") {
        h = {
          "Content-Type": "application/json",
          "x-api-key": getKey(pid),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        };
        body.max_tokens = 280;
        if (messages[0] && messages[0].role === "system") {
          body.system = messages[0].content;
          body.messages = messages.slice(1);
        }
      } else {
        h.Authorization = "Bearer " + getKey(pid);
        if (pid === "openai") {
          body.max_completion_tokens = 280;
          delete body.max_tokens;
        }
        if (REG[pid].hdr) Object.assign(h, REG[pid].hdr());
      }
      // Cheap call: never spend reasoning budget.
      if (st === "ds") body.thinking = { type: "disabled" };
      else if (st === "or") body.reasoning = { effort: "low" };
      else if (st === "openai" || st === "gemini")
        body.reasoning_effort = "low";
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 15000);
      let res, txt;
      try {
        res = await fetch(REG[pid].url, {
          method: "POST",
          headers: h,
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        txt = await res.text();
      } finally {
        clearTimeout(to);
      }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) markBadKey(pid);
        else if (res.status === 429 || res.status >= 500) markRateLimited(pid);
        continue; // try next provider
      }
      const out = parseMetaResponse(txt, st);
      if (out) return out;
    } catch (e) {
      /* rotate to next provider */
    }
  }
  return null;
}
// Pulls the assistant text out of each provider's non-streaming JSON envelope, then parses our JSON tail.
function parseMetaResponse(txt, style) {
  let s = String(txt || "");
  try {
    const j = JSON.parse(s);
    if (style === "anthropic") {
      s = (j.content || []).map((b) => (b && b.text ? b.text : "")).join("\n");
    } else if (style === "gemini" && j.candidates && j.candidates[0]) {
      const c = j.candidates[0].content;
      s = (c && c.parts ? c.parts : [])
        .map((p) => (p && p.text ? p.text : ""))
        .join("\n");
    } else if (j.choices && j.choices[0]) {
      const msg = j.choices[0].message || {};
      s =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content || "");
    } else if (typeof j.text === "string") {
      s = j.text;
    }
  } catch {
    /* wasn't JSON — treat whole body as the text (some proxies) */
  }
  return parseMetaText(s);
}
function parseMetaText(txt) {
  let j;
  try {
    j = JSON.parse(txt);
  } catch {
    // Tolerate ```json fences and prose around the object.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(txt);
    if (fenced) {
      try {
        j = JSON.parse(fenced[1].trim());
      } catch {}
    }
    if (!j) {
      const m = /\{[\s\S]*"followups"[\s\S]*\}/.exec(txt);
      if (m) {
        try {
          j = JSON.parse(m[0]);
        } catch {}
      }
    }
  }
  if (!j || typeof j !== "object") return null;
  let fs = Array.isArray(j.followups)
    ? j.followups
    : Array.isArray(j.questions)
      ? j.questions
      : [];
  fs = fs
    .map((s) => String(s || "").trim())
    .filter((s) => s && s.length <= 120)
    .slice(0, 3);
  const title = typeof j.title === "string" ? j.title.trim() : "";
  if (!fs.length && !title) return null;
  return { followups: fs, title: title || null };
}
function extractJsonTail(s) {
  return parseMetaText(s);
} // exported alias for tests
async function generateExtras(c, msgIdx) {
  try {
    const mode = getExtrasMode();
    const m = MODELS[c.model];
    const originalMsg = c.messages[msgIdx];
    const originalContent = originalMsg && originalMsg.content;
    if (!m || !originalMsg || mode === "off" || (mode === "free" && !m.isFree))
      return;
    // Build a compact transcript — last 6 turns, text only, trimmed.
    const turns = c.messages
      .slice(0, msgIdx + 1)
      .filter(
        (x) =>
          (x.role === "user" && x.content) ||
          (x.role === "assistant" && x.content),
      )
      .slice(-6)
      .map((x) => ({
        role: x.role,
        content: String(x.content || "").slice(0, 1500),
      }));
    if (turns.length < 2) return;
    const sys =
      'You are a follow-up assistant. Given the conversation, return ONLY a compact JSON object — no markdown fences, no prose — with exactly this shape:\n{"title":"SHORT TITLE","followups":["Question one?","Question two?","Question three?"]}\n\nRules:\n- title: 3 to 6 words that capture what this conversation is about, no quotes.\n- followups: exactly 3 natural next questions the user could ask, each under 70 characters, based on what was just discussed. Do not repeat what was already asked.\n- Output nothing except the JSON object.';
    const res = await metaChat(
      [{ role: "system", content: sys }, ...turns],
      m,
      mode,
    );
    if (!res) return;
    const msg = c.messages[msgIdx];
    // The user may have edited/regenerated this turn while the background call
    // was running. Never attach stale suggestions to a different answer.
    if (!msg || msg !== originalMsg || msg.content !== originalContent) return;
    if (res.followups && res.followups.length) {
      msg.followups = res.followups;
      renderFollowups(c, msgIdx);
    }
    // On the first exchange replace the raw first-message slice with the generated title.
    // After that, never overwrite a title the user may have renamed or seen in the sidebar.
    if (res.title && c.messages.length <= 3) {
      const newTitle = res.title.slice(0, 60);
      if (newTitle && newTitle !== c.title) {
        c.title = newTitle;
        renderSidebar();
      }
    }
    saveChats();
  } catch (e) {
    /* chips/title are non-critical; fail silently */
  }
}
function followupsHtml(msg) {
  const fs = msg.followups || [];
  if (!fs.length) return "";
  return `<div class="followups"><span class="followups-label">Follow up</span>${fs.map((q) => `<button type="button" class="chip" data-q="${esc(q)}"><span class="chip-arrow">↗</span>${esc(q)}</button>`).join("")}</div>`;
}
function renderFollowups(c, msgIdx) {
  // A background extras call may finish after the user switches chats.
  if (!chatWrap || !chatWrap.querySelector || getActiveChat() !== c) return;
  const el = chatWrap.querySelector(`.msg.assistant[data-idx="${msgIdx}"]`);
  if (!el) return;
  let box = el.querySelector(".followups");
  const fs = (c.messages[msgIdx] || {}).followups || [];
  if (!fs.length) {
    if (box) box.remove();
    return;
  }
  if (box) {
    box.outerHTML = followupsHtml(c.messages[msgIdx]);
  } else {
    const tpl = document.createElement("template");
    tpl.innerHTML = followupsHtml(c.messages[msgIdx]);
    const node = tpl.content.firstElementChild;
    const src = el.querySelector(".msg-sources");
    if (src) src.after(node);
    else el.appendChild(node);
  }
}
