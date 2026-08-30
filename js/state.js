"use strict";
/* ═══ state.js — shared mutable state + DOM shortcuts ═══ */

let chats = [];
try {
  chats = JSON.parse(localStorage.getItem("chat_history") || "[]");
} catch {
  chats = [];
}
let activeChatId = localStorage.getItem("active_chat_id") || null;
let customModels = JSON.parse(localStorage.getItem("pg_custom_models") || "[]");
let selectedModel = localStorage.getItem("selectedModel");
let savedPrompts = JSON.parse(localStorage.getItem("saved_prompts") || "[]");
let isStreaming = false,
  abortCtrl = null,
  landingDismissed = false,
  userStop = false;
window.isStreaming = false; // mirrored for testability; setStreamingUI keeps it in sync
let rotState = {}; // session-only: {pid:{errors:n,backoffUntil:ts,bad:bool}}
let streamGen = 0; // bumped on stop/chat switch to invalidate in-flight completions
var pendingImages = []; // staged image data-URLs for the next message (var → window, testable)
var pendingFiles = []; // staged text/code files: {name,type,size,text}
var webSearchMode = localStorage.getItem("pg_web_search") || "auto"; // 'off' | 'auto' | 'on'
let searchCache = { gen: -1, srcs: null, ctx: "" }; // reuse search results across provider retries
let nativeRefreshTimer = null; // debounce /models requests while a key is being typed

/* Every "give me a model that definitely exists" moment goes through this one
   helper. Nemotron 3 Ultra is the standing default; if a catalog refresh has
   removed it, degrade gracefully so a retired id can never strand selection. */
const DEFAULT_MODEL = "nem-u";
function pickDefaultModel() {
  if (MODELS[DEFAULT_MODEL]) return DEFAULT_MODEL;
  const all = Object.entries(MODELS);
  if (!all.length) return DEFAULT_MODEL;
  const curated = all.filter(([, m]) => !m.live);
  const pool = curated.length ? curated : all;
  const free = pool.find(([, m]) => m.isFree);
  return (free || pool[0])[0];
}

const $ = (id) =>
  document && document.getElementById ? document.getElementById(id) : null;
const chatWrap = $("chatWrap"),
  userInput = $("userInput"),
  sendBtn = $("sendBtn"),
  welcome = $("welcome"),
  scrollArea = $("scrollArea");
