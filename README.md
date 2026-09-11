# The Playground
A private, multi-provider AI studio built into one portable single-file artifact.

## Quick start
`npm run build`, then open `docs/index.html` directly. Use `npm run dev` for a localhost server.

## Features
Provider rotation, live catalogs, vision and text attachments, web search, per-chat prompts, full-text search, JSON chat export, speech input, keyboard shortcuts, usage/cost estimates, PWA offline shell, and local models.

## Providers
| Tier | Providers | Endpoint / limits |
|---|---|---|
| Free | OpenRouter, Groq, Cerebras, Gemini, Mistral, Cohere, NVIDIA, DeepSeek | Provider APIs; limits vary (shown in Settings) |
| Paid | OpenRouter, Z.ai, Anthropic, OpenAI, SambaNova | Provider APIs; metered/tier limits |
| Local | Ollama, LM Studio | localhost:11434 / localhost:1234; no key |

## Local models
Start Ollama or LM Studio's OpenAI-compatible server and select a discovered local model. On GitHub Pages/non-localhost origins, start Ollama with `OLLAMA_ORIGINS=*`; `npm run dev` generally works without it. LM Studio permits cross-origin requests by default.

## Security
Keys remain only in browser localStorage and go directly to providers—never use shared machines. Anonymous/stealth providers may retain prompts; do not submit secrets. Voice input is the exception to the local-only design: it uses the browser's built-in speech recognition, which streams audio to the browser vendor's servers (Google's, in Chrome).

## Architecture and CI
Modular classic scripts and CSS are bundled by a zero-dependency builder into `docs/index.html`, safe for `file://`. CI builds, syntax-checks, scans for inline handlers, and audits OpenRouter model IDs; Pages deploys the built artifact.
