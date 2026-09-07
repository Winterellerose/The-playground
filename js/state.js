"use strict";
/* ═══ state.js — shared mutable state + DOM shortcuts ═══ */

// 1. Safe chats initialization — start empty, then hydrate from IndexedDB (full migration)
//    Guards against corrupt JSON and literal "null". Migration from localStorage happens in loadChats().
let chats = [];
let chatsLoaded = false;

let activeChatId = null;
try {
  activeChatId = localStorage.getItem("active_chat_id") || null;
} catch {
  activeChatId = null;
}

// 2. Safe customModels initialization (guards against syntax errors that can brick boot)
let customModels = [];
try {
  const parsedModels = JSON.parse(localStorage.getItem("pg_custom_models") || "[]");
  customModels = Array.isArray(parsedModels) ? parsedModels : [];
} catch {
  customModels = [];
}

let selectedModel = null;
try {
  selectedModel = localStorage.getItem("selected_model");
} catch {
  selectedModel = null;
}
let isStreaming = false,
  abortCtrl = null,
  landingDismissed = false,
  userStop = false;
window.isStreaming = false; // mirrored for testability; setStreamingUI keeps it in sync

let rotState = {}; // session-only: {pid:{errors:n,backoffUntil:ts,bad:bool}}
let streamGen = 0; // bumped on stop/chat switch to invalidate in-flight completions
var pendingImages = []; // staged image data-URLs for the next message (var → window, testable)
var pendingFiles = []; // staged text/code files: {name,type,size,text}

// 3. Normalized webSearchMode (guards against obsolete boolean strings like "true"/"false")
var webSearchMode = "auto";
try {
  webSearchMode = localStorage.getItem("pg_web_search") || "auto";
} catch {}
if (!["off", "auto", "on"].includes(webSearchMode)) {
  webSearchMode = "auto";
}

let searchCache = { gen: -1, srcs: null, ctx: "" }; // reuse search results across provider retries
let nativeRefreshTimer = null; // debounce /models requests while a key is being typed

/* Every "give me a model that definitely exists" moment goes through this one
   helper. Nemotron 3 Ultra is the standing default; if a catalog refresh has
   removed it, degrade gracefully so a retired id can never strand selection. */
const DEFAULT_MODEL = "nem-u";
function pickDefaultModel() {
  if (typeof MODELS === "undefined") return DEFAULT_MODEL;
  if (MODELS[DEFAULT_MODEL]) return DEFAULT_MODEL;
  const all = Object.entries(MODELS);
  if (!all.length) return DEFAULT_MODEL;
  const curated = all.filter(([, m]) => !m.live);
  const pool = curated.length ? curated : all;
  const free = pool.find(([, m]) => m.isFree);
  return (free || pool[0])[0];
}

/* ── Full IndexedDB Migration for chats ──
   - Tries IndexedDB first (quota-free, hundreds of MB+)
   - Falls back to localStorage "chat_history" if IDB empty (first run after migration)
   - On fallback, bulk-migrates to IDB and removes localStorage copy to free quota
   - Safe against corrupt JSON, "null", and IDB unavailability
*/
async function loadChats() {
  if (chatsLoaded) return chats;
  // 1) Try IndexedDB
  try {
    if (typeof idbChatsGetAll === "function") {
      const all = await idbChatsGetAll();
      if (Array.isArray(all) && all.length) {
        chats = all;
        chatsLoaded = true;
        try {
          // Clean up old localStorage copy if migration already happened
          localStorage.removeItem("chat_history");
        } catch {}
        return chats;
      }
    }
  } catch (e) {
    // IDB unavailable — fall through to localStorage
  }
  // 2) Fallback to localStorage (pre-migration or IDB blocked)
  try {
    const raw = localStorage.getItem("chat_history");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        chats = parsed;
        chatsLoaded = true;
        // Migrate to IDB in background (best-effort)
        try {
          if (typeof idbChatsBulkPut === "function") {
            await idbChatsBulkPut(chats);
            try {
              localStorage.removeItem("chat_history");
            } catch {}
            if (typeof logRot === "function") {
              logRot(`Migrated ${chats.length} chats to IndexedDB — quota-free`, "ok");
            }
          }
        } catch (migErr) {
          // Migration failed — keep localStorage copy
        }
        return chats;
      }
    }
  } catch {
    // Corrupt JSON — start fresh
  }
  chats = [];
  chatsLoaded = true;
  return chats;
}

const $ = (id) =>
  document && document.getElementById ? document.getElementById(id) : null;

const chatWrap = $("chatWrap"),
  userInput = $("userInput"),
  sendBtn = $("sendBtn"),
  welcome = $("welcome"),
  scrollArea = $("scrollArea");
