"use strict";
/* ═══ ragui.js — document indexing UI, retrieval pipeline, doc manager ═══
   Flow: toggle 📚 in the input row → dropped/pasted/attached text files are
   chunked + BM25-indexed (progress on chips) and stored in IndexedDB. Every
   message while the toggle is ON retrieves the top-k relevant chunks across
   all in-scope docs and injects them into the system lane; the assistant
   message gets a 📚 Docs source row. The frame-bar 📚 button opens the doc
   manager (delete, per-doc scope: this chat / all chats). */

const RAG_MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per file
const RAG_RETRIEVE_MAX_PER_DOC = 4; // cap per doc so one doc can't crowd out others
const RAG_CACHE_DOCS = 2; // in-memory LRU docs (chunk text + index)

/* Session-only: chips for docs being indexed / just indexed. Persisted docs
   live in IndexedDB via ragstore.js. Shape: {id, name, chunks, bytes, state, progress} */
var ragRecent = [];
var ragCache = new Map(); // docId → {chunks, index, usedAt}
let ragIndexingCount = 0;

/* ── Mode toggle ── */
function ragModeOn() {
  try {
    return localStorage.getItem("pg_rag_mode") === "on";
  } catch {
    return false;
  }
}
function ragToggleMode() {
  const on = !ragModeOn();
  try {
    localStorage.setItem("pg_rag_mode", on ? "on" : "off");
  } catch {}
  logRot(
    on
      ? "📚 Doc indexing ON — attach large files to index them; every message retrieves relevant excerpts"
      : "📚 Doc indexing OFF",
    on ? "ok" : "evt"
  );
  syncRagUI();
}
function syncRagUI() {
  const b = $("ragToggle");
  if (b) {
    const on = ragModeOn();
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.title = on
      ? "Doc indexing is ON — text/code attachments are indexed (BM25) instead of pasted; click to turn off"
      : "Doc indexing is OFF — click to index large docs/codebases and chat with them (no size cap of the 512 KB inline limit)";
  }
  ragSyncFrame();
}
function ragSyncFrame() {
  const btn = $("ragDocsBtn"),
    lbl = $("ragDocsState");
  if (!btn || !lbl) return;
  ragUsage().then((u) => {
    const n = u.docs.length;
    lbl.textContent = n ? "Docs (" + n + ")" : "Docs";
    btn.classList.toggle("on", n > 0);
  });
}

/* ── Chip strip (shares #previewStrip with attachments) ── */
function ragChipsHtml() {
  return ragRecent
    .map((d, i) => {
      const sub =
        d.state === "indexing"
          ? "INDEXING " + (d.progress || 0) + "%"
          : esc(fmtFileSize(d.bytes)) + " · " + d.chunks + " CHUNKS";
      return (
        '<div class="file-chip rag-chip"><span class="file-ico">📚</span><div class="file-meta"><div class="file-name" title="' +
        esc(d.name) +
        '">' +
        esc(d.name) +
        '</div><div class="file-sub">' +
        sub +
        "</div></div>" +
        '<button type="button" data-act="remove-rag" data-i="' +
        i +
        '" title="Delete indexed document" aria-label="Delete indexed document ' +
        esc(d.name) +
        '">×</button></div>'
      );
    })
    .join("");
}
function ragDeleteChip(i) {
  const d = ragRecent[i];
  if (!d) return;
  ragRecent.splice(i, 1);
  ragCache.delete(d.id);
  ragRemoveDoc(d.id);
  renderPreviews();
}

/* ── Indexing pipeline ── */
function ragIndexing() {
  return ragIndexingCount > 0;
}
async function ragIndexFiles(files) {
  const list = [...(files || [])].filter(Boolean);
  if (!list.length) return;
  if (!ragAvailable()) {
    logRot("📚 IndexedDB is unavailable — doc indexing disabled (private mode?)", "err");
    return;
  }
  const usage = await ragUsage();
  let bytes = usage.bytes,
    docs = usage.docs.length;
  for (const f of list) {
    if (!isSupportedTextFile(f)) {
      logRot((f.name || "file") + ": unsupported file type for indexing", "warn");
      continue;
    }
    if (f.size > RAG_MAX_FILE_BYTES) {
      logRot((f.name || "file") + ": over the 8 MB per-file indexing limit", "warn");
      continue;
    }
    if (docs >= usage.maxDocs) {
      logRot("📚 Doc limit reached (" + usage.maxDocs + ") — remove one in the 📚 manager", "warn");
      break;
    }
    if (bytes + f.size > usage.maxBytes) {
      logRot((f.name || "file") + ": would exceed the 24 MB index budget — remove a doc first", "warn");
      break;
    }
    try {
      const text = await readFileText(f);
      if (looksBinary(text)) {
        logRot((f.name || "file") + ": binary files aren't supported", "warn");
        continue;
      }
      const chunks = ragChunkText(text);
      if (!chunks.length) {
        logRot((f.name || "file") + ": no text content found", "warn");
        continue;
      }
      const id = crypto.randomUUID();
      const chip = {
        id,
        name: f.name || "document",
        chunks: chunks.length,
        bytes: f.size,
        state: "indexing",
        progress: 0,
      };
      ragRecent.push(chip);
      renderPreviews();
      ragIndexingCount++;
      try {
        const index = await ragBuildIndex(chunks, (p) => {
          chip.progress = p;
          renderPreviews();
        });
        const doc = {
          id,
          name: chip.name,
          size: f.size,
          chunks: chunks.length,
          addedAt: Date.now(),
          chatId: activeChatId || null, // indexed inside a chat → scoped to it
        };
        await ragSaveDoc(doc, chunks);
        ragCache.set(id, { chunks, index, usedAt: Date.now() });
        ragEvictCache();
        chip.state = "ready";
        renderPreviews();
        ragSyncFrame();
        logRot(
          "📚 Indexed " + chip.name + " — " + chunks.length + " chunks, " + fmtFileSize(f.size),
          "ok"
        );
        docs++;
        bytes += f.size;
      } finally {
        ragIndexingCount--;
      }
    } catch (e) {
      logRot("📚 Could not index " + (f.name || "file") + ": " + (e.message || "read error"), "err");
    }
  }
  renderPreviews();
}
function ragEvictCache() {
  while (ragCache.size > RAG_CACHE_DOCS) {
    let oldest = null;
    for (const [id, v] of ragCache)
      if (!oldest || v.usedAt < ragCache.get(oldest).usedAt) oldest = id;
    if (oldest) ragCache.delete(oldest);
    else break;
  }
}

/* ── Retrieval ── */
async function ragEnsureDoc(id) {
  let e = ragCache.get(id);
  if (e) {
    e.usedAt = Date.now();
    return e;
  }
  const doc = await ragLoadDoc(id);
  if (!doc) return null;
  const index = await ragBuildIndex(doc.chunks);
  e = { chunks: doc.chunks, index, usedAt: Date.now() };
  ragCache.set(id, e);
  ragEvictCache();
  return e;
}
/* In-scope docs = global docs + docs scoped to the active chat. */
async function ragInScopeDocs() {
  const c = getActiveChat();
  const docs = await ragListDocs();
  return docs.filter((d) => !d.chatId || (c && d.chatId === c.id));
}
/* Top-k across all in-scope docs, capped per doc. → [{docName, chunk, score}] */
async function ragRetrieve(query, opts) {
  const docs = await ragInScopeDocs();
  if (!docs.length) return [];
  const topK = (opts && opts.topK) || RAG_DEFAULT_TOPK;
  const perDoc = Math.max(1, Math.min(RAG_RETRIEVE_MAX_PER_DOC, topK));
  const perDocHits = [];
  for (const d of docs) {
    const e = await ragEnsureDoc(d.id);
    if (!e) continue;
    const hits = ragSearchIndex(e.index, e.chunks, query, { topK: perDoc });
    for (const h of hits) perDocHits.push({ docName: d.name, docId: d.id, chunk: h.chunk, score: h.score });
  }
  perDocHits.sort((a, b) => b.score - a.score);
  return perDocHits.slice(0, topK);
}
function ragFormatContext(hits) {
  if (!hits || !hits.length) return "";
  const seen = new Map(); // docName → running citation number
  const blocks = hits.map((h) => {
    if (!seen.has(h.docName)) seen.set(h.docName, seen.size + 1);
    const n = seen.get(h.docName);
    return (
      "[Doc " + n + " · " + h.docName + " · excerpt " + (h.chunk.i + 1) + "]\n" +
      h.chunk.text
    );
  });
  return (
    "DOCUMENT CONTEXT (retrieved excerpts from the user's indexed documents — the most relevant passages for the question. Cite them as [Doc N] where used; they are partial excerpts, not the full documents. If the excerpts don't contain the answer, say so):\n\n" +
    blocks.join("\n\n")
  );
}
function ragSourcesHtml(srcs) {
  if (!srcs || !srcs.length) return "";
  const names = new Map();
  srcs.forEach((s) => {
    if (!names.has(s.name)) names.set(s.name, names.size + 1);
  });
  const items = srcs
    .map(
      (s) =>
        '<span class="src-doc" title="' +
        esc(s.snippet || "") +
        '">Doc ' +
        (names.get(s.name) || 1) +
        " · " +
        esc(s.name) +
        " · ch." +
        esc(String(s.chunk)) +
        "</span>"
    )
    .join("");
  return '<div class="msg-sources rag"><span class="src-label">📚 Docs</span>' + items + "</div>";
}

/* ── Doc manager overlay ── */
function renderRagManager() {
  const body = $("rdBody");
  if (!body) return;
  ragUsage().then((u) => {
    if (!body.isConnected) return;
    const c = getActiveChat();
    const rows = u.docs
      .map((d) => {
        const scoped = !!d.chatId;
        const inScope = !scoped || (c && d.chatId === c.id);
        return (
          '<div class="rd-row' + (inScope ? "" : " out") + '">' +
          '<div class="rd-main"><div class="rd-name" title="' + esc(d.name) + '">' + esc(d.name) + "</div>" +
          '<div class="rd-meta">' + esc(fmtFileSize(d.size)) + " · " + esc(String(d.chunks)) + " chunks · " +
          esc(new Date(d.addedAt || Date.now()).toLocaleDateString("en", { month: "short", day: "numeric" })) +
          ' · <button type="button" class="rd-scope" data-act="rag-scope" data-id="' + esc(d.id) + '" title="Toggle scope: this chat only / all chats">' +
          (scoped ? "this chat" : "all chats") + "</button>" +
          (inScope ? "" : ' <span class="rd-out-tag">not in this chat</span>') +
          "</div></div>" +
          '<button type="button" class="rd-del" data-act="rag-del" data-id="' + esc(d.id) + '" title="Delete document" aria-label="Delete ' + esc(d.name) + '">🗑</button>' +
          "</div>"
        );
      })
      .join("");
    body.innerHTML =
      '<div class="rd-usage">' +
      esc(String(u.docs.length)) + " / " + u.maxDocs + " docs · " + esc(fmtFileSize(u.bytes)) + " of " +
      esc(fmtFileSize(u.maxBytes)) + " indexed · " + esc(String(u.chunks)) + " chunks" +
      "</div>" +
      (u.docs.length ? '<div class="rd-list">' + rows + "</div>" : '<div class="rd-empty">No indexed documents yet.<br>Turn on 📚 and drop a large text file, code file, or codebase export.</div>') +
      '<div class="sb-actions"><button class="btn-sm" data-act="rag-add">Add files…</button></div>' +
      '<p class="sb-key-help">Docs stay in this browser (IndexedDB) and are retrieved per message while 📚 is on — top matching excerpts are injected as context, never the whole file. Scope a doc to this chat or all chats. Deleting a chat also deletes its scoped docs.</p>';
  });
}
function openRagManager() {
  const trigger = document.activeElement;
  dismissLanding();
  renderRagManager();
  openModalOverlay("rdOverlay", trigger);
}
function closeRagManager() {
  closeModalOverlay("rdOverlay");
}
function rdBodyClick(e) {
  const add = e.target.closest('[data-act="rag-add"]');
  if (add) {
    $("ragFile").click();
    return;
  }
  const del = e.target.closest('[data-act="rag-del"]');
  if (del) {
    ragRemoveDoc(del.dataset.id);
    return;
  }
  const sc = e.target.closest('[data-act="rag-scope"]');
  if (sc) {
    ragScopeDoc(sc.dataset.id);
    return;
  }
}
async function ragRemoveDoc(id) {
  try {
    await ragDeleteDoc(id);
  } catch (e) {
    logRot("📚 Delete failed: " + (e.message || "storage error"), "err");
    return;
  }
  ragCache.delete(id);
  const i = ragRecent.findIndex((r) => r.id === id);
  if (i >= 0) {
    ragRecent.splice(i, 1);
    renderPreviews();
  }
  logRot("📚 Document deleted", "evt");
  renderRagManager();
  ragSyncFrame();
}
async function ragScopeDoc(id) {
  const docs = await ragListDocs();
  const d = docs.find((x) => x.id === id);
  if (!d) return;
  if (d.chatId) delete d.chatId;
  else {
    if (!getActiveChat()) ensureChat(); // scope to a conversation that starts now
    d.chatId = activeChatId;
  }
  try {
    await ragPut("docs", d);
  } catch (e) {
    logRot("📚 Scope change failed: " + (e.message || "storage error"), "err");
    return;
  }
  logRot("📚 " + d.name + " → " + (d.chatId ? "this chat only" : "all chats"), "evt");
  renderRagManager();
}
/* When a chat dies, its scoped docs are dead weight — remove them too. */
function ragDeleteChatDocs(chatId) {
  if (!chatId || !ragAvailable()) return;
  ragListDocs()
    .then((docs) =>
      Promise.all(docs.filter((d) => d.chatId === chatId).map((d) => ragRemoveDoc(d.id)))
    )
    .catch(() => {});
}

/* Init hook called from app.js. */
function initRag() {
  syncRagUI();
}
