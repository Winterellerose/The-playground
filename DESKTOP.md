# Desktop Packaging (Tauri)

This project is intentionally **zero-runtime-deps**: `docs/index.html` is a fully self-contained artifact (20 JS modules + vendored libs + CSS inlined, ~420KB). That makes it ideal for a Tauri wrapper — no Node server, no bundler at runtime.

Result: **sub-10MB native binary** for macOS / Windows / Linux.

## Prerequisites

- Rust stable: https://rustup.rs
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- System deps (Linux):
  ```bash
  sudo apt update
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo3-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- Node 18+ (for `@tauri/cli`)

## One-time setup

```bash
npm install
```

This installs `@tauri/cli` locally.

## Dev mode (hot reload)

Tauri will serve `../docs` as `frontendDist` and use `http://localhost:8000` as devUrl:

```bash
# Terminal 1 — static server for devUrl (optional, Tauri can also load the built file directly)
npm run dev
# Terminal 2
npm run tauri:dev
# or
npx tauri dev
```

`beforeBuildCommand` is set to `npm run build`, so every Tauri build automatically re-bundles `docs/index.html` from the modular sources.

## Production build

```bash
npm run build          # rebuild docs/index.html from js/*.js
npm run tauri:build    # produces native bundle in src-tauri/target/release/bundle/
```

Outputs:

- **macOS**: `src-tauri/target/release/bundle/dmg/The Playground_3.0.0_aarch64.dmg` + `.app`
- **Windows**: `src-tauri/target/release/bundle/msi/` + `nsis/`
- **Linux**: `AppImage`, `deb`, `rpm`

Typical binary size: **~6-9MB** (Tauri runtime + WebView, no Chromium bundled).

## Why this works

- `tauri.conf.json`:
  ```json
  {
    "build": {
      "frontendDist": "../docs",
      "beforeBuildCommand": "npm run build"
    },
    "app": { "security": { "csp": null } }
  }
  ```
  - `frontendDist` points to the self-contained `docs/` folder
  - `csp: null` allows the inlined `<script>` tags (marked, purify, highlight, app bundle) — otherwise Tauri's default CSP would block inline scripts
  - No `shell:open` restrictions beyond allowing external links (`target="_blank"` from markdown)

- All app data (chats, keys, settings) lives in `localStorage` → automatically persisted via WebView's storage, no extra Rust code needed.

- Icons are in `src-tauri/icons/` copied from `icons/`.

## Customization

- Change `productName`, `identifier`, `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
- Add more capabilities in `src-tauri/capabilities/default.json` if you need filesystem/dialog plugins
- Currently only `shell:allow-open` is enabled to let markdown links open in system browser

## Troubleshooting

- If `cargo` not found, restart shell after rustup
- If build fails on `tauri-plugin-shell`, run `cargo update`
- If window is blank, check that `docs/index.html` was built (`npm run build`) — Tauri loads that file directly in production
