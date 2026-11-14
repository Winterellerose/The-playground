# The Playground
A private, multi-provider AI studio built into one portable single-file artifact.

## Quick start
`npm run build`, then open `docs/index.html` directly. Use `npm run dev` for a localhost server.

## Deploy on Netlify
Connect the private GitHub repository to Netlify and import it as a new project. `netlify.toml` sets the build command (`npm run build`) and publish directory (`docs`). Select the branch you want Netlify to deploy; merge the configuration into that branch first if necessary.

A private GitHub repository does **not** make the deployed site private. Configure site access protection through Netlify if your plan supports it, or use another access-control solution before publishing if the site must require login. API keys entered into the app remain in each user's browser; do not add keys to the repository.

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

## CORS-blocked providers (NVIDIA NIM)
`integrate.api.nvidia.com` sends no `Access-Control-Allow-Origin`, so a browser can never call it directly — that is a property of their gateway, not of your key (curl with the same key works fine). In this app such a provider is marked `noCors`, stays out of rotation, and says **"Unverified"** instead of "Fail" in Settings. To use it anyway, run a local relay that adds the headers and forwards to `https://integrate.api.nvidia.com/v1` (e.g. `nim-cors-proxy` on `http://localhost:8765`), then put that root in Settings → NVIDIA NIM → **CORS relay**; the key test, the live model list and chat requests all go through it. The page's CSP pre-allows `localhost:8765` and `127.0.0.1:8765` — a relay on another port needs the `connect-src` line in `index.html` (and the built `docs/index.html`) extended. Plain-http relays are accepted only on localhost; anything remote must be https, since the key rides along in the clear otherwise.

Until a relay is configured, an NVIDIA model is *not* quietly sent somewhere else: a model the picker labels **FREE** is never re-routed onto a metered route (OpenRouter lists many of the same ids as paid, and answering there costs credits — that is where the old `that model needs OpenRouter credits` wall came from). You get an explanation at pick time instead of a 402 at send time, and the frame header always names the provider that will really answer (`NVIDIA NIM → OPENROUTER` when a legitimate free fallback is in use). Custom models behave the same way — pick the provider that actually serves the ID; the add form detects an ID that belongs to another provider's live list instead of saving it as OpenRouter's, and remembers the provider for next time.

## Security
Keys remain only in browser localStorage and go directly to providers—never use shared machines. Anonymous/stealth providers may retain prompts; do not submit secrets. Voice input is the exception to the local-only design: it uses the browser's built-in speech recognition, which streams audio to the browser vendor's servers (Google's, in Chrome).

## Architecture and CI
Modular classic scripts and CSS are bundled by a zero-dependency builder into `docs/index.html`, safe for `file://`. CI builds, syntax-checks, scans for inline handlers, and audits OpenRouter model IDs; Pages deploys the built artifact.
