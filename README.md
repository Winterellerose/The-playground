# The Playground

A private, multi-provider AI studio built into one portable single-file artifact.

## Quick start

Install Node.js 22 (or `nvm use`, which selects the supported Node 22 version) and Python 3, then run:

```sh
npm ci
npm run build
npm run dev
```

Open http://localhost:8000 for source development, or open `docs/index.html` directly for the portable build. The installable/offline shell is supported when serving the **built `docs/` directory** over HTTP(S), not when opening a file directly.

### Checks before shipping

```sh
npm test                 # offline checks; does not rewrite built files
npm run lint             # correctness lint; formatting is separate
npm run verify:vendor    # compares vendored libraries to npm; requires internet
npm run build            # deliberately regenerates docs/ artifacts
npx playwright install --with-deps chromium
npm run test:browser     # built app in Chromium, with external traffic mocked
```

Browser tests use their own server on port 8001. To use an already-installed Chromium executable, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. They do not require real API keys. Live provider authentication, availability and CORS still require a manual check with your own key. `npm run audit:models` contacts OpenRouter; exit 1 means catalog drift and exit 2 means the audit could not complete.

Edit source files, not `docs/index.html`. Rebuild before deploying or committing updated artifacts. CI checks pull requests and pushes to `master`, and Pages publishes the exact successful CI commit. The catalog update workflow preserves existing model IDs and capability metadata; additions receive stable IDs.

## Deploy on Netlify

Connect the private GitHub repository to Netlify and import it as a new project. `netlify.toml` sets the build command (`npm run build`) and publish directory (`docs`). Select the branch you want Netlify to deploy; merge the configuration into that branch first if necessary.

A private GitHub repository does **not** make the deployed site private. Configure site access protection through Netlify if your plan supports it, or use another access-control solution before publishing if the site must require login. API keys entered into the app remain in each user's browser; do not add keys to the repository.

## Features

Provider rotation, live catalogs, vision and text attachments, web search, per-chat prompts, full-text search, JSON chat export, speech input, keyboard shortcuts, usage/cost estimates, PWA offline shell, and local models.

## Providers

| Tier  | Providers                                                             | Endpoint / limits                              |
| ----- | --------------------------------------------------------------------- | ---------------------------------------------- |
| Free  | OpenRouter, Groq, Cerebras, Gemini, Mistral, Cohere, NVIDIA, DeepSeek | Provider APIs; limits vary (shown in Settings) |
| Paid  | OpenRouter, Z.ai, Anthropic, OpenAI, SambaNova                        | Provider APIs; metered/tier limits             |
| Local | Ollama, LM Studio                                                     | localhost:11434 / localhost:1234; no key       |

## Local models

Start Ollama or LM Studio's OpenAI-compatible server and select a discovered local model. On GitHub Pages/non-localhost origins, start Ollama with `OLLAMA_ORIGINS=https://your-site.example` (use your exact app origin, not a wildcard); `npm run dev` generally works without it. LM Studio permits cross-origin requests by default.

## CORS-blocked providers (NVIDIA NIM)

`integrate.api.nvidia.com` sends no `Access-Control-Allow-Origin`, so a browser can never call it directly — that is a property of their gateway, not of your key (curl with the same key works fine). In this app such a provider is marked `noCors`, stays out of rotation, and says **"Unverified"** instead of "Fail" in Settings. To use it anyway, run a local relay that adds the headers and forwards to `https://integrate.api.nvidia.com/v1` (e.g. `nim-cors-proxy` on `http://localhost:8765`), then put that root in Settings → NVIDIA NIM → **CORS relay**; the key test, the live model list and chat requests all go through it. The page's CSP pre-allows `localhost:8765` and `127.0.0.1:8765` — a relay on another port needs the `connect-src` line in `index.html` (and the built `docs/index.html`) extended. Plain-http relays are accepted only on localhost; anything remote must be https, since the key rides along in the clear otherwise.

Until a relay is configured, an NVIDIA model is _not_ quietly sent somewhere else: a model the picker labels **FREE** is never re-routed onto a metered route (OpenRouter lists many of the same ids as paid, and answering there costs credits — that is where the old `that model needs OpenRouter credits` wall came from). You get an explanation at pick time instead of a 402 at send time, and the frame header always names the provider that will really answer (`NVIDIA NIM → OPENROUTER` when a legitimate free fallback is in use). Custom models behave the same way — pick the provider that actually serves the ID; the add form detects an ID that belongs to another provider's live list instead of saving it as OpenRouter's, and remembers the provider for next time.

## Security

Keys remain in browser localStorage and go directly to providers, **or through the relay you configure**. A relay can read your key and prompts; only use one you control. Never use shared machines. Anonymous/stealth providers may retain prompts; do not submit secrets. Voice input is the exception to the local-only design: it uses the browser's built-in speech recognition, which streams audio to the browser vendor's servers (Google's, in Chrome).

## Architecture and CI

Modular classic scripts and CSS are bundled by a zero-dependency builder into `docs/index.html`, safe for `file://`. CI builds, syntax-checks, scans for inline handlers, and audits OpenRouter model IDs; Pages deploys the built artifact.


## NVIDIA relay setup and trust

Start the included local helper with `npm run relay:nim`. It binds only to `127.0.0.1:8765` by default. In Settings use `http://127.0.0.1:8765`. Both the root URL and a URL ending in `/v1` work; outgoing requests preserve `/v1/models` and `/v1/chat/completions`. Use `npm run relay:nim:port -- 9999` for a different port, and update CSP accordingly.

For an app hosted on Netlify, GitHub Pages, or another host, explicitly allow its exact **origin** (scheme + hostname + optional port, no path) on the relay:

```sh
ALLOWED_ORIGINS=https://your-site.netlify.app npm run relay:nim
# Multiple trusted origins: comma-separated, no wildcard.
```

Localhost HTTP origins and `null` origins (portable `file://` pages) are supported by default. Note that sandboxed browser documents can also have a `null` origin; this is a deliberate convenience trade-off for portable builds, not authentication. CORS does not stop non-browser clients. Do not expose the helper publicly without your own authentication and rate limiting. `--host` is an explicit opt-in to another listen address; `--target` exists for testing and must be HTTPS except for loopback test servers.

For Cloudflare, deploy `nim-cors-proxy.workers.js` **together with `relay-policy.js`** using Wrangler. Set its `ALLOWED_ORIGINS` variable to your hosted app's exact origin. The Worker does not accept arbitrary `workers.dev` origins.

For any new remote relay, add its exact HTTPS origin to `connect-src` in the CSP meta tag in **source `index.html`**, then run `npm run build`. The Settings field alone cannot loosen the browser's security policy. Keep the allowlist narrow; do not replace it with `*` or `https:`. Remote keys travel through the relay, even though the connection is encrypted.

## Backups and recovery

Chats are local to this browser and origin, not synced to an account. Export chats regularly from Settings; exports include images. Large images use IndexedDB, and metadata uses localStorage. Deleting or clearing chats schedules cleanup of unreferenced stored images after metadata is saved. Missing images remain referenced so a temporary read failure does not permanently erase them.

If saved chat data is damaged, the app preserves the original data and blocks new history saves. In Settings choose **Recover saved chats** to download the original JSON, then explicitly confirm reset only after saving the download. Canceling leaves the original data untouched. A storage-full warning means you should export a backup before reloading.
