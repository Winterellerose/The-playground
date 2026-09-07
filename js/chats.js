"use strict";
/* ═══ chats.js — chat CRUD, sidebar, per-chat prompts, import/export (IndexedDB full migration) ═══ */

/* ── Chats — now quota-free via IndexedDB ──
   saveChats() writes to IDB (bulk put). Falls back to localStorage only if IDB unavailable.
   Migration from localStorage happens in state.js loadChats().
*/
async function saveChats() {
  const active = getActiveChat();
  if (active) {
    try {
      await moveLargeImages(active);
    } catch {}
  }
  // Try IndexedDB first (quota-free)
  try {
    if (typeof idbChatsBulkPut === "function") {
      await idbChatsBulkPut(chats);
      // Free localStorage copy to avoid quota issues
      try {
        localStorage.removeItem("chat_history");
      } catch {}
      return true;
    }
  } catch (e) {
    // IDB failed — fall through to localStorage fallback
    if (typeof logRot === "function") {
      logRot("IndexedDB save failed — falling back to localStorage", "warn");
    }
  }
  // Fallback: localStorage with filtering (old behavior)
  const LIMIT = 300 * 1024;
  const toStorable = (arr) =>
    arr.map((chat) => ({
      ...chat,
      messages: (chat.messages || []).map((msg) => {
        if (!msg.images || !msg.images.length) return msg;
        const filtered = msg.images.filter((img) => {
          if (
            typeof img === "string" &&
            img.length > LIMIT &&
            img.startsWith("data:")
          )
            return false;
          return true;
        });
        if (filtered.length === msg.images.length) return msg;
        return { ...msg, images: filtered };
      }),
    }));
  try {
    localStorage.setItem("chat_history", JSON.stringify(toStorable(chats)));
    return true;
  } catch (e) {
    try {
      localStorage.setItem("chat_history", JSON.stringify(toStorable(chats)));
      return true;
    } catch {}
    if (typeof logRot === "function") {
      logRot(
        "Storage full — message was not saved; export & prune old chats",
        "err",
      );
    }
    return false;
  }
}

function renderSidebar() {
  if (!document || !$("sbList")) return;
  const q = ($("sbSearch")?.value || "").toLowerCase();
  const list = $("sbList");
  const items = [...chats]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .filter((c) => { if (!q) return true; const title=(c.title||"").toLowerCase(); if(title.includes(q)) return true; for(const m of c.messages||[]) if(String(m.content||"").toLowerCase().includes(q)) return true; return false; });
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
      let snippet=""; if(q && !(c.title||"").toLowerCase().includes(q)) { for(const x of c.messages||[]) { const v=String(x.content||"").replace(/\s+/g, " "), at=v.toLowerCase().indexOf(q); if(at>=0) { snippet=`<span class="sb-snippet">${esc(v.slice(Math.max(0,at-20),at))}<mark>${esc(v.slice(at,at+q.length))}</mark>${esc(v.slice(at+q.length,at+40))}</span>`; break; } } }
      return `<div class="sb-item${c.id === activeChatId ? " active" : ""}" data-cid="${esc(c.id)}" tabindex="0" role="button" aria-label="Open conversation: ${ttl}"><span class="sb-title">${ttl}</span><span class="sb-meta">${sp}<span class="sb-model-tag">${esc(badge)}</span>${date}${snippet}</span><button class="sb-del" title="Delete" aria-label="Delete conversation: ${ttl}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></div>`;
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
  try {
    localStorage.removeItem("active_chat_id");
  } catch {}
  resetWelcome();
  resetScrollPin();
  renderSidebar();
  syncChatPromptUI();
  closeSidebar();
  if (userInput && userInput.focus) userInput.focus();
}
function resetWelcome() {
  if (!chatWrap || !welcome) return;
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
    try {
      localStorage.setItem("active_chat_id", c.id);
    } catch {}
  }
  return getActiveChat();
}
// loadChat re-attaches #welcome (hidden) rather than just wiping the wrap: wiping
// used to detach it, so the next selectModel() threw on the missing #welcomeModel.
async function loadChat(id) {
  stopStream();
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  activeChatId = id;
  try {
    localStorage.setItem("active_chat_id", id);
  } catch {}
  if ((c.messages||[]).some((m)=>(m.images||[]).some(idbRef))) {
    try {
      await hydrateImages(c);
    } catch {}
    // Re-enter after hydration (images now data URLs)
    return loadChat(id);
  }
  if (c.model && MODELS[c.model]) selectModel(c.model, false);
  if (!chatWrap || !welcome) return;
  chatWrap.innerHTML = "";
  chatWrap.appendChild(welcome);
  welcome.style.display = "none";
  c.messages.forEach((m, i) => {
    m.role === "user"
      ? addUserMsg(m.content, i, false, m.images, m.files)
      : addAssistantMsg(m, i);
  });
  resetScrollPin();
  renderSidebar();
  syncChatPromptUI();
  updateUsageMeter();
  scrollToBottom();
}
async function deleteChat(id) {
  stopStream();
  const chat = chats.find((c) => c.id === id);
  if (chat) {
    for (const m of chat.messages || []) {
      for (const img of m.images || []) {
        if (img && typeof img === "object" && typeof img.idb === "string") {
          try {
            await idbDelete(img.idb);
          } catch {}
        }
      }
    }
    try {
      await idbChatDelete(id);
    } catch {}
  }
  chats = chats.filter((c) => c.id !== id);
  await saveChats();
  if (activeChatId === id) newChat();
  else renderSidebar();
}
async function clearChat() {
  stopStream();
  const c = getActiveChat();
  if (c) {
    c.messages = [];
    c.updatedAt = Date.now();
    await saveChats();
  }
  resetWelcome();
  resetScrollPin();
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
async function saveChatPrompt() {
  const c = ensureChat(); // saving from a fresh window is what starts that conversation
  const v = $("chatSysPrompt").value.trim().slice(0, CHAT_SYS_MAX);
  if (v) c.systemPrompt = v;
  else delete c.systemPrompt; // cleared → drop the key entirely
  await saveChats();
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
async function exportChats() {
  // Clone chats to avoid mutating live state
  let exportable;
  try {
    exportable = typeof structuredClone === "function"
      ? structuredClone(chats)
      : JSON.parse(JSON.stringify(chats));
  } catch {
    exportable = JSON.parse(JSON.stringify(chats));
  }
  // Hydrate any {idb} references to portable data URLs
  for (const chat of exportable) {
    for (const msg of chat.messages || []) {
      if (!msg.images || !msg.images.length) continue;
      for (let i = 0; i < msg.images.length; i++) {
        const ref = msg.images[i];
        if (ref && typeof ref === "object" && typeof ref.idb === "string") {
          try {
            const data = await idbGet(ref.idb);
            if (typeof data === "string") msg.images[i] = data;
          } catch {}
        }
      }
    }
  }
  const blob = new Blob([JSON.stringify(exportable, null, 2)], {
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
  r.onload = async () => {
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
      const ok = await saveChats();
      if (!ok) {
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
/* ── Export to Markdown & Copy Transcript ── */
function chatToMarkdown(chat) {
  if (!chat) return "";
  const title = String(chat.title || "Conversation").trim() || "Conversation";
  const model = chat.model ? (MODELS[chat.model]?.name || chat.model) : "—";
  const created = chat.createdAt ? new Date(chat.createdAt).toLocaleString() : "";
  const updated = chat.updatedAt ? new Date(chat.updatedAt).toLocaleString() : "";
  const sysPrompt = chat.systemPrompt ? String(chat.systemPrompt).trim() : "";
  const globalSys = (() => { try { return localStorage.getItem("sys_prompt") || ""; } catch { return ""; } })();

  let md = `# ${title}\n\n`;
  md += `> **Model:** ${model} | **Created:** ${created} | **Updated:** ${updated} | **Messages:** ${(chat.messages||[]).length}\n>\n`;
  if (globalSys) md += `> **Global System Prompt:** ${globalSys.replace(/\n/g, " ")}\n>\n`;
  if (sysPrompt) md += `> **Chat System Prompt:** ${sysPrompt.replace(/\n/g, " ")}\n>\n`;
  md += `\n---\n\n`;

  for (const m of chat.messages || []) {
    const role = m.role === "user" ? "You" : (m.meta?.pName || m.meta?.m || MODELS[chat.model]?.name || "AI");
    md += `## ${m.role === "user" ? "You" : role}\n\n`;
    if (m.thinking) {
      md += `<details><summary>Thinking</summary>\n\n${String(m.thinking).trim()}\n\n</details>\n\n`;
    }
    const content = String(m.content || "").trim();
    if (content) {
      md += `${content}\n\n`;
    } else if (m.role === "user" && (m.images?.length || m.files?.length)) {
      md += `*(attachment only)*\n\n`;
    }
    if (m.images && m.images.length) {
      const imgs = m.images.map((img) => {
        if (typeof img === "string") return `- Image attached (${Math.round(img.length/1024)}KB)`;
        if (img && typeof img === "object" && img.idb) return `- Image: ${img.name || "image"} (${img.mime || "image"}) [stored in IndexedDB]`;
        return null;
      }).filter(Boolean).join("\n");
      if (imgs) md += `${imgs}\n\n`;
    }
    if (m.files && m.files.length) {
      for (const f of m.files) {
        const name = f.name || "file";
        const lang = (fileExt(name) ? EXT_LANG[fileExt(name)] || "" : "");
        md += `**File: ${name}**\n\n\`\`\`${lang}\n${String(f.text||"").slice(0, 20000)}\n\`\`\`\n\n`;
      }
    }
    if (m.sources && m.sources.length) {
      md += `**Sources:**\n`;
      for (const s of m.sources) {
        if (s && s.url) md += `- [${s.title || s.url}](${s.url})\n`;
      }
      md += `\n`;
    }
    md += `---\n\n`;
  }
  md += `\n*Exported from The Playground on ${new Date().toLocaleString()}*\n`;
  return md;
}

async function exportCurrentChatAsMarkdown() {
  const c = getActiveChat();
  if (!c || !c.messages || !c.messages.length) {
    logRot("No active conversation to export", "warn");
    return;
  }
  // Ensure any IDB image refs are noted (we don't embed base64 in md for size)
  let md;
  try {
    md = chatToMarkdown(c);
  } catch (e) {
    logRot("Markdown export failed: " + e.message, "err");
    return;
  }
  const safeTitle = String(c.title || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chat";
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeTitle}-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  logRot("Chat exported as Markdown", "ok");
}

async function copyFullTranscript() {
  const c = getActiveChat();
  if (!c || !c.messages || !c.messages.length) {
    logRot("No active conversation to copy", "warn");
    return;
  }
  let md;
  try {
    md = chatToMarkdown(c);
  } catch (e) {
    logRot("Copy failed: " + e.message, "err");
    return;
  }
  const showCopied = () => {
    logRot("Full transcript copied to clipboard", "ok");
    // Visual feedback on the button if present
    const btn = $("copyTranscriptBtn");
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove("copied");
      }, 1400);
    }
  };
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(md);
      showCopied();
      return;
    } catch {}
  }
  // Fallback for HTTP / LAN
  const ta = document.createElement("textarea");
  ta.value = md;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
    showCopied();
  } catch {
    logRot("Clipboard copy failed — try HTTPS or use Export .md", "err");
  }
  ta.remove();
}

function suggest(t) {
  if (!userInput) return;
  userInput.value = t;
  userInput.focus();
  userInput.dispatchEvent(new Event("input"));
}
function pickFollowup(q) {
  if (isStreaming) return;
  const qs = String(q || "").trim();
  if (!qs) return;
  if (!userInput) return;
  userInput.value = qs;
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 300) + "px";
  userInput.focus();
  sendMessage();
}
