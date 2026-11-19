'use strict';
/* ═══ state.js — shared mutable state + DOM shortcuts ═══ */

function validStoredMessage(message) {
  if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') return false;
  if (message.thinking != null && typeof message.thinking !== 'string') return false;
  if (message.files != null && (!Array.isArray(message.files) || message.files.some(file =>
    !file || typeof file.name !== 'string' || typeof file.text !== 'string'))) return false;
  if (message.images != null && (!Array.isArray(message.images) || message.images.some(image =>
    typeof image !== 'string' && (!image || typeof image.idb !== 'string' || typeof image.mime !== 'string' || typeof image.name !== 'string')))) return false;
  if (message.sources != null && (!Array.isArray(message.sources) || message.sources.some(source =>
    !source || typeof source.url !== 'string' || typeof source.title !== 'string'))) return false;
  if (message.followups != null && (!Array.isArray(message.followups) || message.followups.some(text => typeof text !== 'string'))) return false;
  if (message.alts != null && (!Array.isArray(message.alts) || message.alts.some(alt =>
    !validStoredMessage({ ...alt, role: 'assistant', alts: undefined })))) return false;
  return true;
}
let chats = [];
let chatRecoveryBlocked = false;
try {
  const raw = localStorage.getItem('chat_history') || '[]';
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some(c => !c || typeof c !== 'object' ||
    typeof c.id !== 'string' || typeof c.title !== 'string' || !Array.isArray(c.messages) ||
    c.messages.some(m => !validStoredMessage(m)))) throw Error('Invalid saved chats');
  chats = parsed;
} catch {
  // Keep the original bytes untouched until the user explicitly recovers them.
  chatRecoveryBlocked = true;
}
function recoverSavedChats() {
  if (!chatRecoveryBlocked) return;
  const raw = localStorage.getItem('chat_history') || '';
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'playground-chat-recovery.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  if (confirm('A recovery download has started. Only continue if you have saved it. Reset the damaged chat history?')) {
    localStorage.removeItem('chat_history');
    location.reload();
  }
}
let activeChatId = localStorage.getItem('active_chat_id') || null;
let customModels = [];
try {
  customModels = JSON.parse(localStorage.getItem('pg_custom_models') || '[]');
  if (!Array.isArray(customModels)) customModels = [];
} catch {
  customModels = [];
}
let selectedModel = localStorage.getItem('selected_model');
let isStreaming = false,
  abortCtrl = null,
  landingDismissed = false,
  stopGen = -1; // generation explicitly stopped by the user (Stop button)
window.isStreaming = false; // mirrored for testability; setStreamingUI keeps it in sync
let rotState = {}; // session-only: {pid:{errors:n,backoffUntil:ts,bad:bool}}
let streamGen = 0; // bumped on stop/chat switch to invalidate in-flight completions
var pendingImages = []; // staged image data-URLs for the next message (var → window, testable)
var pendingFiles = []; // staged text/code files: {name,type,size,text}
var webSearchMode = localStorage.getItem('pg_web_search') || 'auto'; // 'off' | 'auto' | 'on'
let searchCache = { gen: -1, srcs: null, ctx: '' }; // reuse search results across provider retries
let nativeRefreshTimer = null; // debounce /models requests while a key is being typed

/* Every "give me a model that definitely exists" moment goes through this one
   helper. Nemotron 3 Ultra is the standing default; if a catalog refresh has
   removed it, degrade gracefully so a retired id can never strand selection. */
const DEFAULT_MODEL = 'nem-u';
function pickDefaultModel() {
  if (MODELS[DEFAULT_MODEL]) return DEFAULT_MODEL;
  const all = Object.entries(MODELS);
  if (!all.length) return DEFAULT_MODEL;
  const curated = all.filter(([, m]) => !m.live);
  const pool = curated.length ? curated : all;
  const free = pool.find(([, m]) => m.isFree);
  return (free || pool[0])[0];
}

const $ = id => (document && document.getElementById ? document.getElementById(id) : null);
const chatWrap = $('chatWrap'),
  userInput = $('userInput'),
  sendBtn = $('sendBtn'),
  welcome = $('welcome'),
  scrollArea = $('scrollArea');
