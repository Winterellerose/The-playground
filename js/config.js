/* ═══ config.js — providers, model catalog, constants ═══ */

"use strict";
/* ════════════════════════════════════════════════════════════
   THE PLAYGROUND v3.0.0 — multi-provider AI studio (single file)
   v3.0.0: PWA/offline shell; Ollama + LM Studio local models; full-text chat search; keyboard shortcuts and voice input; context/cost estimates; IndexedDB large-image storage; token-aware history; CI, Pages and model audit; stale duplicate tree removed and README added.
   v2.9.4: sticky scroll — auto-scroll pauses when you scroll up to reread during a stream; a ↓ Latest pill returns to the newest message. Sending, regenerating or switching chats re-engages the chase.
   v2.9.3: accessibility — every icon-only control carries a real
   accessible name (aria-label); the landing, model cards, sidebar rows,
   picker sections and thinking disclosures are keyboard focusable and
   Space/Enter activatable; the three overlays are semantic dialogs
   (role=dialog, aria-modal, aria-labelledby) with focus moved in on
   open, Tab trapped, Escape closing, and focus returned to the trigger;
   the Thinking/Reasoning control is a role=switch with live aria-checked
   and the WEB pill is aria-pressed. Visible :focus-visible outlines.
   v2.9.2: model-ID audit (2026-08-28, against the live OpenRouter
   catalog + provider docs). Retired ghosts removed: owl-alpha,
   poolside/laguna-m.1:free & xs.2:free (→ S 2.1 / XS 2.1),
   openai/gpt-oss-20b:free (free tier cancelled; base is paid),
   gemini-3-flash-preview, x-ai/grok-4.3, minimax/minimax-m3.
   Fixed: gemma-4-26b id was missing its -it suffix; glm-5.3-flash
   metadata (1.3M ctx, vision, always-on reasoning); vision flags on
   current Claude models; 4 stale FALLBACK_IDs. New: npm run
   audit:models re-runs the drift check against the live catalog, and
   CI pins the curated OpenRouter IDs to an audited allowlist so none
   change silently.
   v2.9.1: zero inline event handlers — every onclick, oninput, onchange
   and onkeydown attribute is replaced by addEventListener wiring: static buttons declare data-act
   resolved by one delegated body listener; dynamic surfaces (model picker,
   chat messages, key rows, staged attachments) delegate at their
   containers so re-renders never re-bind; form controls bind by id; the
   Send/Stop button is a single state-driven listener. Enforced in CI by a
   no-inline-handlers scan plus a real-click UI smoke test.
   v2.9: hardened markdown rendering — the hand-rolled renderer is
   replaced by vendored marked (parser) + DOMPurify (sanitizer) under a
   default-deny allowlist with an explicit URL policy (href: http/https/
   mailto/# · img src: http/https only; everything else stripped).
   Both libs are embedded byte-identical to their npm artifacts, and the
   renderer fails CLOSED to escaped text if they're ever unavailable.
   Adversarial XSS fixtures run in CI (tests/xss.fixtures.js).
   v2.8.3: per-chat system prompts — the 📝 Prompt button in the
   chat frame header opens a one-textarea editor for a prompt that
   applies to that conversation only. It layers on top of the
   global Settings prompt (both are sent; the chat one wins on
   conflict), persists inside the chat record so it exports and
   imports with it, and is flagged by 📝 in the sidebar list.
   v2.8.2: ox-alpha retired — OpenRouter pulled the anonymous
   stealth preview, so GLM 5.3 Flash (z-ai/glm-5.3-flash, paid)
   takes the featured slot, and pickDefaultModel() now resolves
   every fallback (Nemotron 3 Ultra first, then the best free
   model still on hand) instead of hard-coding an ID that can be
   retired out from under us. applyCatalog also repaints the hero
   when a refresh drops the selected model as a ghost.
   v2.8.1: custom-model fixes — IDs are validated against the live
   catalogs before saving (bogus IDs are rejected with a clear
   reason), custom models get their own picker section AND appear
   in All-models search so they can always be found and removed
   with ×, adds persist immediately (the old save order dropped
   the newest entry), and stale saved entries self-heal on boot.
   v2.8: live web search with OFF/AUTO/ON modes, via Tavily /
   Serper / Brave (multi-provider, free tiers, auto-fallback). AUTO
   searches automatically for recent/current topics. Configure keys
   in Settings → Web Search.
   v2.7: auto-update model lists for EVERY provider via /models.
   Gemini, Mistral, Cohere, NVIDIA, DeepSeek, Z.ai, OpenAI,
   SambaNova, Anthropic) via their /models endpoints, just like
   OpenRouter — new models appear in All-models search automatically.
   v2.6: premium, organized model picker — three clean buckets
   (★ Featured · 🆓 Free · 💎 Premium) with a single global search
   over the full live catalog; zero clutter, no 400-model wall.
   v2.5: accurate model catalog — live OpenRouter catalog now
   reconciles the hand-written list on every refresh, correcting
   stale isFree flags (paid models marked free), context lengths
   and vision, and dropping OpenRouter IDs that no longer exist.
   Replaced fictional IDs (GPT-5.5, Claude Opus 5, DeepSeek V4, etc.)
   with real, currently-available model IDs.
   (v2.9.2 note: that "fictional IDs" claim was wrong — GPT-5.5, Claude
   Opus 5 and DeepSeek V4 are real, currently-listed models. The real
   work of v2.5 was the live reconciliation.)
   v2.4: Stop button actually stops — abort is wired up before the
   web-search pre-fetch (so Stop works during search too) and the
   streaming UI is always reset via try/finally, so a stopped/
   interrupted generation can never wedge the Send button.
   v2.3: smart follow-up chips — one cheap extra non-streaming
   call after each answer returns 3 next-question suggestions
   (parsed from a hidden JSON tail), rendered as clickable
   chips under the assistant message.
   v2.2: free in-browser web search (DuckDuckGo via CORS proxies
   + Wikipedia fallback) · LIVE WEB CONTEXT injected for every
   provider · 🌐 sources row · today's date always in the prompt
   · friendlier 402 credit-wall copy. No OpenRouter web plugin.
   v2.1: live OpenRouter catalog · vision image upload · WEB pill.
   Also: local text/code file attachments (drag, picker, paste) —
   TXT/MD/JSON/CSV/code, 4 files / 512 KB / 1.5 MB; no PDF yet.
   v2.0 fixes kept: XSS-safe markdown, honest rotation w/ labels,
   401≠429 handling, no poisoned history, retry, key testing,
   usage stats, custom models, export/import, chat search.
   ════════════════════════════════════════════════════════════ */

const REG = {
  openrouter: {
    name: "OpenRouter",
    type: "free",
    url: "https://openrouter.ai/api/v1/chat/completions",
    models: "https://openrouter.ai/api/v1/models",
    style: "or",
    usage: true,
    rpm: "20 RPM",
    hdr: () => ({
      "HTTP-Referer": location.origin,
      "X-Title": "The Playground",
    }),
  },
  groq: {
    name: "Groq",
    type: "free",
    url: "https://api.groq.com/openai/v1/chat/completions",
    models: "https://api.groq.com/openai/v1/models",
    style: "openai",
    usage: true,
    rpm: "30 RPM",
  },
  cerebras: {
    name: "Cerebras",
    type: "free",
    url: "https://api.cerebras.ai/v1/chat/completions",
    models: "https://api.cerebras.ai/v1/models",
    style: "openai",
    rpm: "30 RPM",
  },
  gemini: {
    name: "Gemini",
    type: "free",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    models: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    style: "gemini",
    rpm: "10 RPM",
  },
  mistral: {
    name: "Mistral",
    type: "free",
    url: "https://api.mistral.ai/v1/chat/completions",
    models: "https://api.mistral.ai/v1/models",
    style: "none",
    rpm: "1 rps",
  },
  cohere: {
    name: "Cohere",
    type: "free",
    url: "https://api.cohere.com/compatibility/v1/chat/completions",
    models: "https://api.cohere.com/v1/models",
    style: "none",
    rpm: "trial",
  },
  nvidia: {
    name: "NVIDIA NIM",
    type: "free",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    models: "https://integrate.api.nvidia.com/v1/models",
    style: "none",
    rpm: "40 RPM",
  },
  deepseek: {
    name: "DeepSeek",
    type: "free",
    url: "https://api.deepseek.com/chat/completions",
    models: "https://api.deepseek.com/models",
    style: "ds",
    usage: true,
    metered: true,
    rpm: "cheap PAYG",
  },
  openrouter_paid: {
    name: "OpenRouter Paid",
    type: "paid",
    url: "https://openrouter.ai/api/v1/chat/completions",
    models: "https://openrouter.ai/api/v1/models",
    style: "or",
    usage: true,
    rpm: "1000 RPM",
    hdr: () => ({
      "HTTP-Referer": location.origin,
      "X-Title": "The Playground",
    }),
  },
  zai: {
    name: "Z.ai",
    type: "paid",
    url: "https://api.z.ai/api/paas/v4/chat/completions",
    models: "https://api.z.ai/api/paas/v4/models",
    style: "ds",
    rpm: "pay-as-you-go",
  },
  anthropic: {
    name: "Anthropic",
    type: "paid",
    url: "https://api.anthropic.com/v1/messages",
    models: "",
    style: "anthropic",
    rpm: "tier-based",
  },
  openai: {
    name: "OpenAI",
    type: "paid",
    url: "https://api.openai.com/v1/chat/completions",
    models: "https://api.openai.com/v1/models",
    style: "openai",
    usage: true,
    rpm: "tier-based",
  },
  ollama: { name: "Ollama", type: "free", local: true, url: "http://localhost:11434/v1/chat/completions", models: "http://localhost:11434/v1/models", style: "openai", rpm: "local" },
  lmstudio: { name: "LM Studio", type: "free", local: true, url: "http://localhost:1234/v1/chat/completions", models: "http://localhost:1234/v1/models", style: "openai", rpm: "local" },
  sambanova: {
    name: "SambaNova",
    type: "paid",
    url: "https://api.sambanova.ai/v1/chat/completions",
    models: "https://api.sambanova.ai/v1/models",
    style: "openai",
    rpm: "tier-based",
  },
};
const FREE_PIDS = Object.keys(REG).filter((k) => REG[k].type === "free");
const PAID_PIDS = Object.keys(REG).filter((k) => REG[k].type === "paid");
const KEY_INPUTS = {
  openrouter: "keyORFree",
  groq: "keyGroq",
  cerebras: "keyCerebras",
  gemini: "keyGemini",
  mistral: "keyMistral",
  cohere: "keyCohere",
  nvidia: "keyNvidia",
  deepseek: "keyDeepSeek",
  openrouter_paid: "keyORPaid",
  zai: "keyZai",
  anthropic: "keyAnthropic",
  openai: "keyOpenAI",
  sambanova: "keySambaNova",
};
// Only used when the exact model truly can't be served anywhere else.
// These must be real, currently-available model IDs per provider.
// Audited 2026-08-28 against the live OpenRouter catalog + provider docs
// (glm-4.5-air:free, gemini-3-flash-preview, gpt-5.4-mini and claude-sonnet-4-5
// were replaced — see the v2.9.2 changelog). Re-audit: npm run audit:models.
const FALLBACK_ID = {
  openrouter: "nvidia/nemotron-3-ultra-550b-a55b:free",
  groq: "openai/gpt-oss-120b",
  cerebras: "gpt-oss-120b",
  gemini: "gemini-3.5-flash-lite",
  mistral: "mistral-small-latest",
  cohere: "command-a-03-2025",
  nvidia: "meta/llama-3.3-70b-instruct",
  deepseek: "deepseek-chat",
  openrouter_paid: "google/gemini-3.1-pro-preview",
  zai: "glm-4.6",
  openai: "gpt-5.5",
  anthropic: "claude-sonnet-5",
  sambanova: "Meta-Llama-3.3-70B-Instruct",
};

const GROUPS = [
  {
    id: "featured",
    name: "★ Featured",
    blurb: "Hand-picked favourites.",
    icon: "★",
  },
  {
    id: "free",
    name: "Free models",
    blurb: "No API key / credits required.",
    icon: "🆓",
  },
  {
    id: "premium",
    name: "Premium models",
    blurb: "Best-in-class, pay-as-you-go.",
    icon: "💎",
  },
  {
    id: "custom",
    name: "Your custom models",
    blurb: "Added by you — × removes.",
    icon: "＋",
  },
  {
    id: "search",
    name: "All models",
    blurb: "Full live catalog — type to search.",
    icon: "🔎",
    search: true,
  },
];
// Reassign every non-live curated model to free/premium based on its isFree flag,
// so the picker stays in three clean buckets regardless of its old provider group.
// Featured models stay featured; custom models always land in their own bucket
// (this also migrates custom entries saved by v2.8 and earlier under 'featured').
function regroupModels() {
  Object.values(MODELS).forEach((m) => {
    if (m.live) {
      m.group = "search";
      return;
    }
    if (m.custom) {
      m.group = "custom";
      return;
    }
    if (m.group === "featured") return;
    m.group = m.isFree ? "free" : "premium";
  });
}

const MODELS = {
  /* ── Featured ── */
  // Audited 2026-08-28 against the live catalog: owl-alpha AND ox-alpha (anonymous stealth previews)
  // are both gone — nem-35l (brand-new, free, 1M ctx) takes the freed featured slot.
  "glm-53f": {
    name: "GLM 5.3 Flash",
    badge: "GLM 5.3F",
    group: "featured",
    provider: "openrouter_paid",
    apiId: "z-ai/glm-5.3-flash",
    isFree: false,
    adaptive: true,
    intel: 4,
    ctx: "1.3M",
    vision: true,
    desc: "Z.ai native-multimodal flash reasoner (1.31M ctx, vision, always-on reasoning). Paid, metered per token.",
  },
  "nem-35l": {
    name: "Nemotron 3.5 Lightning",
    badge: "NEM-3.5L",
    group: "featured",
    provider: "openrouter",
    apiId: "nvidia/nemotron-3.5-lightning:free",
    isFree: true,
    intel: 4,
    ctx: "1M",
    params: "30B/A3B",
    desc: "New (Aug 2026) open MoE built for high-throughput agent pipelines. FREE.",
  },
  "nem-u": {
    name: "Nemotron 3 Ultra",
    badge: "NEM-U",
    group: "featured",
    provider: "openrouter",
    apiId: "nvidia/nemotron-3-ultra-550b-a55b:free",
    isFree: true,
    intel: 5,
    ctx: "1M",
    params: "550B/A55B",
    desc: "Hybrid Mamba-Transformer MoE frontier reasoner. FREE.",
  },
  /* ── OpenRouter free ── */
  "lag-m": {
    name: "Laguna S 2.1",
    badge: "LAG-S",
    group: "or_free",
    provider: "openrouter",
    apiId: "poolside/laguna-s-2.1:free",
    isFree: true,
    intel: 4,
    ctx: "262K",
    params: "118B/A8B",
    desc: "Poolside flagship coding agent (Jul 2026; replaced Laguna M.1). FREE.",
  },
  "lag-xs": {
    name: "Laguna XS 2.1",
    badge: "LAG-XS",
    group: "or_free",
    provider: "openrouter",
    apiId: "poolside/laguna-xs-2.1:free",
    isFree: true,
    intel: 3,
    ctx: "262K",
    params: "33B/A3B",
    desc: "Compact Poolside coding agent with tools + reasoning. FREE.",
  },
  "nem-s": {
    name: "Nemotron 3 Super",
    badge: "NEM-S",
    group: "or_free",
    provider: "openrouter",
    apiId: "nvidia/nemotron-3-super-120b-a12b:free",
    isFree: true,
    intel: 4,
    ctx: "262K",
    params: "120B/A12B",
    desc: "Efficient hybrid MoE, agent-optimized. FREE.",
  },
  "gemma-4": {
    name: "Gemma 4 26B A4B",
    badge: "GEMMA 4",
    group: "or_free",
    provider: "openrouter",
    apiId: "google/gemma-4-26b-a4b-it:free",
    isFree: true,
    intel: 3,
    ctx: "262K",
    params: "26B/A4B",
    vision: true,
    desc: "Google open multimodal MoE. FREE.",
  },
  // (oss-20f removed 2026-08-28: openai/gpt-oss-20b:free was retired; the paid base and the Groq-hosted 20B remain.)
  /* ── Groq ── */
  "groq-oss120": {
    name: "GPT-OSS 120B",
    badge: "OSS 120B",
    group: "groq",
    provider: "groq",
    apiId: "openai/gpt-oss-120b",
    isFree: true,
    intel: 4,
    ctx: "131K",
    desc: "~500 tok/s on LPU. Production tier.",
  },
  "groq-oss20": {
    name: "GPT-OSS 20B",
    badge: "OSS 20B",
    group: "groq",
    provider: "groq",
    apiId: "openai/gpt-oss-20b",
    isFree: true,
    intel: 3,
    ctx: "131K",
    desc: "~1000 tok/s on LPU.",
  },
  "groq-qwen36": {
    name: "Qwen3.6 27B",
    badge: "QWEN 3.6",
    group: "groq",
    provider: "groq",
    apiId: "qwen/qwen3.6-27b",
    isFree: true,
    intel: 4,
    ctx: "131K",
    vision: true,
    desc: "Preview multimodal (vision + reasoning), ~500 tok/s.",
  },
  "groq-compound": {
    name: "Compound",
    badge: "COMPOUND",
    group: "groq",
    provider: "groq",
    apiId: "groq/compound",
    isFree: true,
    intel: 4,
    ctx: "131K",
    desc: "Agentic system with built-in web search + code execution.",
  },
  /* ── Cerebras ── */
  "cb-oss120": {
    name: "GPT-OSS 120B",
    badge: "OSS 120B",
    group: "cerebras",
    provider: "cerebras",
    apiId: "gpt-oss-120b",
    isFree: true,
    intel: 4,
    ctx: "65K",
    desc: "~3000 tok/s wafer-scale inference.",
  },
  "cb-gemma": {
    name: "Gemma 4 31B",
    badge: "GEMMA 4",
    group: "cerebras",
    provider: "openrouter",
    apiId: "google/gemma-4-31b-it:free",
    isFree: true,
    intel: 3,
    ctx: "262K",
    vision: true,
    desc: "Google multimodal Gemma 4 31B, free via OpenRouter.",
  },
  /* ── Gemini (Flash = free via AI Studio; Pro = PAID only since Apr 2026) ── */
  g38f: {
    name: "Gemini 3.8 Flash",
    badge: "GEM 3.8",
    group: "free", // regroupModels() lands it in the 🆓 Free bucket regardless
    provider: "gemini", // direct Google AI Studio (AQ… key) — never touches OpenRouter credits
    apiId: "gemini-3.8-flash",
    isFree: true, // green FREE pill
    noTemp: true, // 3.8 Flash is reasoning-driven: Google bans temperature/top_p/top_k (HTTP 400 if sent)
    intel: 5,
    ctx: "1M",
    vision: true,
    thinking: true,
    desc: "Google frontier workhorse. Free via Google AI Studio.",
  },
  g36f: {
    name: "Gemini 3.6 Flash",
    badge: "GEM 3.6",
    group: "gemini",
    provider: "gemini",
    apiId: "gemini-3.6-flash",
    isFree: true,
    intel: 4,
    ctx: "1M",
    vision: true,
    desc: "Latest stable Flash. Free tier. Agentic coding sweet spot.",
  },
  g35l: {
    name: "Gemini 3.5 Flash-Lite",
    badge: "GEM 3.5L",
    group: "gemini",
    provider: "gemini",
    apiId: "gemini-3.5-flash-lite",
    isFree: true,
    intel: 3,
    ctx: "1M",
    vision: true,
    desc: "Fastest, cheapest Gemini. Free tier. High volume.",
  },
  // (g3flash removed 2026-08-28: gemini-3-flash-preview is gone from the live catalog; 3.5-lite and 3.6 remain.)
  g31p: {
    name: "Gemini 3.1 Pro",
    badge: "GEM 3.1P",
    group: "gemini",
    provider: "openrouter_paid",
    apiId: "google/gemini-3.1-pro-preview",
    isFree: false,
    intel: 5,
    ctx: "1M",
    vision: true,
    desc: "Flagship. Paid-only (Google removed free Pro access Apr 2026); routed via OpenRouter.",
  },
  g25p: {
    name: "Gemini 2.5 Pro",
    badge: "GEM 2.5P",
    group: "gemini",
    provider: "openrouter_paid",
    apiId: "google/gemini-2.5-pro",
    isFree: false,
    intel: 5,
    ctx: "1M",
    vision: true,
    desc: "Previous flagship. Paid-only now; routed via OpenRouter.",
  },
  /* ── Mistral ── */
  "mi-small": {
    name: "Mistral Small",
    badge: "MISTRAL S",
    group: "mistral",
    provider: "mistral",
    apiId: "mistral-small-latest",
    isFree: true,
    intel: 3,
    ctx: "128K",
    desc: "Reliable Apache-licensed all-rounder.",
  },
  "mi-mini": {
    name: "Ministral 8B",
    badge: "MINISTRAL",
    group: "mistral",
    provider: "mistral",
    apiId: "ministral-8b-latest",
    isFree: true,
    intel: 2,
    ctx: "128K",
    params: "8B",
    desc: "Edge-class. 1 req/sec free tier.",
  },
  /* ── Cohere ── */
  "co-a+": {
    name: "Command A+",
    badge: "CMD A+",
    group: "cohere",
    provider: "cohere",
    apiId: "command-a-plus-05-2026",
    isFree: true,
    intel: 4,
    ctx: "256K",
    vision: true,
    desc: "Cohere flagship-class. Vision + agentic.",
  },
  "co-ar": {
    name: "Command A Reasoning",
    badge: "CMD AR",
    group: "cohere",
    provider: "cohere",
    apiId: "command-a-reasoning-08-2025",
    isFree: true,
    intel: 4,
    ctx: "256K",
    desc: "Cohere thinking model, 23 languages.",
  },
  /* ── NVIDIA ── */
  "nv-llama33": {
    name: "Llama 3.3 70B",
    badge: "LLAMA 3.3",
    group: "nvidia",
    provider: "nvidia",
    apiId: "meta/llama-3.3-70b-instruct",
    isFree: true,
    intel: 3,
    ctx: "128K",
    desc: "Meta workhorse hosted by NVIDIA. 40 RPM.",
  },
  "nv-dsv4f": {
    name: "DeepSeek V4 Flash",
    badge: "DS V4F",
    group: "nvidia",
    provider: "nvidia",
    apiId: "deepseek-ai/deepseek-v4-flash",
    isFree: true,
    intel: 4,
    ctx: "163K",
    desc: "V4-Flash MoE on NVIDIA infra. FREE.",
  },
  /* ── DeepSeek ── */
  "ds-v4f": {
    name: "DeepSeek V4 Flash",
    badge: "DS V4F",
    group: "deepseek",
    provider: "openrouter_paid",
    apiId: "deepseek/deepseek-v4-flash",
    isFree: false,
    intel: 4,
    ctx: "1M",
    thinking: true,
    desc: "284B/A13B MoE. Cheap & fast; paid (was briefly free).",
  },
  "ds-v4p": {
    name: "DeepSeek V4 Pro",
    badge: "DS V4P",
    group: "deepseek",
    provider: "openrouter_paid",
    apiId: "deepseek/deepseek-v4-pro",
    isFree: false,
    intel: 5,
    ctx: "1M",
    thinking: true,
    desc: "1.6T/A49B flagship MoE. Paid; strong reasoning.",
  },
  /* ── OpenRouter exclusives / aliases (paid) ── */
  "kimi-latest": {
    name: "Kimi Latest",
    badge: "KIMI ∞",
    group: "or_paid",
    provider: "openrouter_paid",
    apiId: "~moonshotai/kimi-latest",
    isFree: false,
    noTemp: true,
    intel: 4,
    ctx: "262K",
    thinking: true,
    desc: "Alias that always routes to newest Kimi.",
  },
  "gpt-latest": {
    name: "GPT Latest",
    badge: "GPT ∞",
    group: "or_paid",
    provider: "openrouter_paid",
    apiId: "~openai/gpt-latest",
    isFree: false,
    noTemp: true,
    intel: 5,
    ctx: "1M",
    thinking: true,
    desc: "Alias that always routes to newest OpenAI GPT.",
  },
  /* ── Anthropic ── */
  "opus-5": {
    name: "Claude Opus 5",
    badge: "OPUS 5",
    group: "anthropic",
    provider: "anthropic",
    apiId: "claude-opus-5",
    isFree: false,
    adaptive: true,
    intel: 5,
    ctx: "1M",
    vision: true,
    desc: "Best GA model for agentic coding. Adaptive thinking always on.",
  },
  "fable-5": {
    name: "Claude Fable 5",
    badge: "FABLE 5",
    group: "anthropic",
    provider: "anthropic",
    apiId: "claude-fable-5",
    isFree: false,
    adaptive: true,
    intel: 5,
    ctx: "1M",
    vision: true,
    desc: "Highest capability. Long-running agents.",
  },
  "sonnet-5": {
    name: "Claude Sonnet 5",
    badge: "SONNET 5",
    group: "anthropic",
    provider: "anthropic",
    apiId: "claude-sonnet-5",
    isFree: false,
    adaptive: true,
    intel: 4,
    ctx: "1M",
    vision: true,
    desc: "Best speed-to-intelligence ratio. Rejects manual thinking + custom temperature.",
  },
  "opus-48": {
    name: "Claude Opus 4.8",
    badge: "OPUS 4.8",
    group: "anthropic",
    provider: "anthropic",
    apiId: "claude-opus-4-8",
    isFree: false,
    adaptive: true,
    intel: 5,
    ctx: "1M",
    vision: true,
    desc: "Previous-gen flagship.",
  },
  "haiku-45": {
    name: "Claude Haiku 4.5",
    badge: "HAIKU 4.5",
    group: "anthropic",
    provider: "anthropic",
    apiId: "claude-haiku-4-5",
    isFree: false,
    intel: 3,
    ctx: "200K",
    vision: true,
    desc: "Near-instant, budget-friendly.",
  },
  /* ── Z.ai ── */
  "glm-51": {
    name: "GLM-5.1",
    badge: "GLM-5.1",
    group: "zai",
    provider: "zai",
    apiId: "glm-5.1",
    isFree: false,
    thinking: true,
    intel: 4,
    ctx: "200K",
    desc: "Elite coding/agentic MoE.",
  },
  "glm-5": {
    name: "GLM-5",
    badge: "GLM-5",
    group: "zai",
    provider: "zai",
    apiId: "glm-5",
    isFree: false,
    thinking: true,
    intel: 4,
    ctx: "200K",
    desc: "Agentic engineering foundation model.",
  },
  "glm-47": {
    name: "GLM-4.7",
    badge: "GLM-4.7",
    group: "zai",
    provider: "zai",
    apiId: "glm-4.7",
    isFree: false,
    thinking: true,
    intel: 3,
    ctx: "200K",
    desc: "Reliable all-rounder.",
  },
  /* ── OpenAI ── */
  "gpt-55": {
    name: "GPT-5.5",
    badge: "GPT-5.5",
    group: "openai",
    provider: "openai",
    apiId: "gpt-5.5",
    isFree: false,
    thinking: true,
    intel: 5,
    ctx: "1M",
    vision: true,
    desc: "OpenAI frontier.",
  },
  "gpt-55p": {
    name: "GPT-5.5 Pro",
    badge: "5.5 PRO",
    group: "openai",
    provider: "openai",
    apiId: "gpt-5.5-pro",
    isFree: false,
    thinking: true,
    intel: 5,
    ctx: "1M",
    desc: "Deep-reasoning, high-stakes workloads.",
  },
  /* ── Moonshot / MiniMax / xAI ── */
  "kimi-25": {
    name: "Kimi K2.5",
    badge: "KIMI K2.5",
    group: "moonshot",
    provider: "openrouter_paid",
    apiId: "moonshotai/kimi-k2.5",
    isFree: false,
    thinking: true,
    intel: 4,
    ctx: "262K",
    params: "1T/A32B",
    vision: true,
    desc: "Multimodal MoE, agentic swarm workflows.",
  },
  // (mm3 removed 2026-08-28: minimax/minimax-m3 is absent from the live catalog.)
  // (grok-43 removed 2026-08-28: x-ai/grok-4.3 is absent from the live catalog.)
};
window.MODELS = MODELS; // expose for tests/debugging (const isn't on the global)
