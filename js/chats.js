"use strict";
/* ═══ chats.js — chat CRUD, sidebar, per-chat prompts, import/export ═══ */

/* ── Chats ── */
function saveChats() {
  try {
    localStorage.setItem("chat_history", JSON.stringify(chats));
    return true;
  } catch (e) {
    logRot(
      "Storage full — message was not saved; export & prune old chats",
      "err",
    );
    return false;
  }
}
function renderSidebar() {
  if (!document || !$("sbList")) return;
  const q = ($("sbSearch")?.value || "").toLowerCase();
  const list = $("sbList");
  const items = [...chats]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .filter((c) => !q || (c.title || "").toLowerCase().includes(q));
  if (!items.length) {
    list.innerHTML =
      '<div class="sb-empty">' +
      (q ? "No matches" : "No conversations yet") +
      "</div>";
    return;
  }
  list.innerHTML = items
    .map((c) => {
      const m = MODELS[c.model],
        badge = m ? m.badge : (c.model || "?").slice(0, 8);
      const date = c.updatedAt
        ? new Date(c.updatedAt).toLocaleDateString("en", {
            month: "short",
            day: "numeric",
          })
        : "";
      const sp =
        c.systemPrompt && String(c.systemPrompt).trim()
          ? '<span class="sb-sp" title="Has its own system prompt">📝</span>'
          : "";
      const ttl = esc(c.title || "New chat");
      return `<div class="sb-item${c.id === activeChatId ? " active" : ""}" data-cid="${esc(c.id)}" tabindex="0" role="button" aria-label="Open conversation: ${ttl}"><span class="sb-title">${ttl}</span><span class="sb-meta">${sp}<span class="sb-model-tag">${esc(badge)}</span>${date}</span><button class="sb-del" title="Delete" aria-label="Delete conversation: ${ttl}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></div>`;
    })
    .join("");
}
function renameChat(id) {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  const t = prompt("Rename conversation:", c.title || "");
  if (t && t.trim()) {
    c.title = t.trim();
    saveChats();
    renderSidebar();
  }
}
function newChat() {
  stopStream();
  activeChatId = null;
  localStorage.removeItem("active_chat_id");
  resetWelcome();
  renderSidebar();
  syncChatPromptUI();
  closeSidebar();
  userInput.focus();
}
function resetWelcome() {
  chatWrap.innerHTML = "";
  chatWrap.appendChild(welcome);
  welcome.style.display = "flex";
}
function getActiveChat() {
  return activeChatId ? chats.find((c) => c.id === activeChatId) : null;
}
function ensureChat() {
  if (!activeChatId || !getActiveChat()) {
    const c = {
      id: crypto.randomUUID(),
      title: "New chat",
      messages: [],
      model: selectedModel,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    chats.push(c);
    activeChatId = c.id;
    localStorage.setItem("active_chat_id", c.id);
  }
  return getActiveChat();
}
// loadChat re-attaches #welcome (hidden) rather than just wiping the wrap: wiping
// used to detach it, so the next selectModel() threw on the missing #welcomeModel.
function loadChat(id) {
  stopStream();
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  activeChatId = id;
  localStorage.setItem("active_chat_id", id);
  if (c.model && MODELS[c.model]) selectModel(c.model, false);
  chatWrap.innerHTML = "";
  chatWrap.appendChild(welcome);
  welcome.style.display = "none";
  c.messages.forEach((m, i) => {
    m.role === "user"
      ? addUserMsg(m.content, i, false, m.images, m.files)
      : addAssistantMsg(m, i);
  });
  renderSidebar();
  syncChatPromptUI();
  scrollToBottom();
}
function deleteChat(id) {
  stopStream();
  chats = chats.filter((c) => c.id !== id);
  saveChats();
  if (activeChatId === id) newChat();
  else renderSidebar();
}
function clearChat() {
  stopStream();
  const c = getActiveChat();
  if (c) {
    c.messages = [];
    c.updatedAt = Date.now();
    saveChats();
  }
  resetWelcome();
  renderSidebar();
}

/* ── Per-chat system prompt (v2.8.3) ──
   A conversation-scoped layer on top of the global system prompt from
   Settings. It lives on the chat object, so it persists with the chat history,
   exports/imports with the chat, and can never leak into another conversation.
   Merge order is in composeSys(): global first, chat last → chat wins conflicts. */
const CHAT_SYS_MAX = 4000;
function chatSysText() {
  const c = getActiveChat();
  return c && typeof c.systemPrompt === "string"
    ? c.systemPrompt.trim().slice(0, CHAT_SYS_MAX)
    : "";
}
function syncChatPromptUI() {
  const btn = $("chatPromptBtn");
  if (!btn) return;
  const has = !!chatSysText();
  btn.classList.toggle("on", has);
  const lbl = $("chatPromptState");
  if (lbl) lbl.textContent = has ? "Prompt set" : "Prompt";
}
function openChatPrompt() {
  const trigger = document.activeElement;
  dismissLanding();
  const ta = $("chatSysPrompt");
  ta.maxLength = CHAT_SYS_MAX;
  ta.value = chatSysText();
  openModalOverlay("cpOverlay", trigger);
  setTimeout(() => {
    if (ta.focus) ta.focus();
  }, 60);
}
function closeChatPrompt() {
  closeModalOverlay("cpOverlay");
}
function saveChatPrompt() {
  const c = ensureChat(); // saving from a fresh window is what starts that conversation
  const v = $("chatSysPrompt").value.trim().slice(0, CHAT_SYS_MAX);
  if (v) c.systemPrompt = v;
  else delete c.systemPrompt; // cleared → drop the key entirely
  saveChats();
  renderSidebar();
  syncChatPromptUI();
  closeChatPrompt();
  logRot(
    v
      ? "Chat prompt saved — applies to this conversation only"
      : "Chat prompt cleared",
    v ? "ok" : "warn",
  );
}
function clearChatPrompt() {
  $("chatSysPrompt").value = "";
  saveChatPrompt();
}
function exportChats() {
  const blob = new Blob([JSON.stringify(chats, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    "playground-chats-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  logRot("Chats exported", "ok");
}
const MAX_IMPORT_TEXT = 2 * 1024 * 1024;
function importedSource(s) {
  const url = safeWebUrl(s && s.url);
  if (!url) return null;
  return {
    title: String(s.title || url).slice(0, 300),
    url,
    snippet: String(s.snippet || "").slice(0, 4000),
  };
}
function importedFile(f) {
  if (!f || typeof f !== "object") return null;
  const text = String(f.text == null ? "" : f.text);
  if (text.length > FILE_MAX_BYTES) return null;
  return {
    name: String(f.name || "file").slice(0, 255),
    type: String(f.type || "text/plain").slice(0, 100),
    size: Math.min(FILE_MAX_BYTES, Math.max(0, Number(f.size) || text.length)),
    text,
  };
}
function importedMeta(meta) {
  if (!meta || typeof meta !== "object") return undefined;
  const out = {};
  ["p", "pName", "m"].forEach((k) => {
    if (meta[k] != null) out[k] = String(meta[k]).slice(0, 200);
  });
  ["ms", "tps", "in", "out"].forEach((k) => {
    const n = Number(meta[k]);
    if (Number.isFinite(n)) out[k] = n;
  });
  return Object.keys(out).length ? out : undefined;
}
function importedAlt(a) {
  if (!a || typeof a !== "object") return null;
  return {
    content: String(a.content || "").slice(0, MAX_IMPORT_TEXT),
    thinking: String(a.thinking || "").slice(0, MAX_IMPORT_TEXT) || undefined,
    meta: importedMeta(a.meta),
    sources: Array.isArray(a.sources)
      ? a.sources.map(importedSource).filter(Boolean).slice(0, 12)
      : undefined,
  };
}
function importedMessage(m) {
  if (!m || !["user", "assistant"].includes(m.role)) return null;
  const out = {
    role: m.role,
    content: String(m.content || "").slice(0, MAX_IMPORT_TEXT),
  };
  if (m.role === "user") {
    const images = Array.isArray(m.images)
      ? m.images.map(safeImageDataUrl).filter(Boolean).slice(0, MAX_IMGS)
      : [];
    const files = Array.isArray(m.files)
      ? m.files.map(importedFile).filter(Boolean).slice(0, MAX_FILES)
      : [];
    if (images.length) out.images = images;
    if (files.length) out.files = files;
  } else {
    const thinking = String(m.thinking || "").slice(0, MAX_IMPORT_TEXT);
    if (thinking) out.thinking = thinking;
    out.meta = importedMeta(m.meta);
    const sources = Array.isArray(m.sources)
      ? m.sources.map(importedSource).filter(Boolean).slice(0, 12)
      : [];
    if (sources.length) out.sources = sources;
    const followups = Array.isArray(m.followups)
      ? m.followups
          .map((q) =>
            String(q || "")
              .trim()
              .slice(0, 120),
          )
          .filter(Boolean)
          .slice(0, 3)
      : [];
    if (followups.length) out.followups = followups;
    const alts = Array.isArray(m.alts)
      ? m.alts.map(importedAlt).filter(Boolean).slice(0, 12)
      : [];
    if (alts.length) {
      out.alts = alts;
      out.activeAlt = Math.min(
        alts.length - 1,
        Math.max(0, Number(m.activeAlt) || 0),
      );
    }
  }
  return out;
}
function importedChat(raw, have) {
  if (!raw || !Array.isArray(raw.messages)) return null;
  const rawId = String(raw.id || "");
  if (rawId && have.has(rawId)) return null;
  let id = /^[A-Za-z0-9_-]{1,128}$/.test(rawId) ? rawId : crypto.randomUUID();
  while (have.has(id)) id = crypto.randomUUID();
  const messages = raw.messages
    .slice(0, 500)
    .map(importedMessage)
    .filter(Boolean);
  have.add(id);
  const chat = {
    id,
    title: String(raw.title || "Imported chat").slice(0, 120),
    messages,
    model:
      typeof raw.model === "string" && MODELS[raw.model]
        ? raw.model
        : selectedModel,
    createdAt: Number.isFinite(Number(raw.createdAt))
      ? Number(raw.createdAt)
      : Date.now(),
    updatedAt: Number.isFinite(Number(raw.updatedAt))
      ? Number(raw.updatedAt)
      : Date.now(),
  };
  // Per-chat prompts travel with the export — but as plain text, capped, never as
  // whatever shape the file happened to carry (arrays/objects/10MB strings).
  const sp =
    typeof raw.systemPrompt === "string"
      ? raw.systemPrompt.trim().slice(0, CHAT_SYS_MAX)
      : "";
  if (sp) chat.systemPrompt = sp;
  return chat;
}
function importChats(inp) {
  const f = inp.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const arr = JSON.parse(r.result);
      if (!Array.isArray(arr)) throw 0;
      const have = new Set(chats.map((c) => String(c.id))),
        start = chats.length;
      arr.forEach((raw) => {
        const c = importedChat(raw, have);
        if (c) chats.push(c);
      });
      const added = chats.length - start;
      if (!saveChats()) {
        chats.splice(start);
        return;
      }
      renderSidebar();
      logRot(`Imported ${added} conversation(s)`, "ok");
    } catch {
      logRot("Import failed: invalid or unsupported JSON", "err");
    }
  };
  r.readAsText(f);
  inp.value = "";
}
function suggest(t) {
  userInput.value = t;
  userInput.focus();
  userInput.dispatchEvent(new Event("input"));
}
function pickFollowup(q) {
  if (isStreaming) return;
  const qs = String(q || "").trim();
  if (!qs) return;
  userInput.value = qs;
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 300) + "px";
  userInput.focus();
  sendMessage();
}
