# AGENTS.md — Word GPT+ Workspace Fork Control

## Purpose and operating model

This `workspace/` directory is the active fork control surface for the Word GPT+ add-in.

- This repo version is maintained as a forked improvement target of the upstream project.
- The goal is to evolve the browser-hosted Word task-pane runtime (Vue + LangChain agent path) and related backend services, including external tool providers and telemetry.
- Changes should prioritize safe, incremental execution over wide, uncoupled rewrites.

If you are deciding implementation scope, treat this folder as authoritative for:

- Local add-in behavior and tool orchestration
- Local config model and settings persistence
- Tool-provider integration experiments (e.g., MCP bridge adapters)
- Issue and reference tracking in `references/`

## Project architecture

### What runs where

- `workspace/` → Add-in frontend (Office task pane), Vue 3 + TypeScript + Vite.
- `workspace/proxy-server/` → lightweight Node proxy used for provider forwarding and local request logging.
- `references/` → design, planning, and integration notes (`dev-guidelines.md`, `dev-guidelines-agent.md`, `issues-list.md`).

### Tooling model

- LLM provider selection is the **chat backend provider** (official/groq/azure/gemini/ollama).
- Tool execution is a separate layer injected into LangChain agent runs.
- Current local tool sources:
  - Word tools: `src/utils/wordTools.ts`
  - General tools: `src/utils/generalTools.ts`
  - Runtime merge point: `getActiveTools()` in `src/pages/HomePage.vue`

## Setup and local development

Run these from `workspace/`.

```bash
cd workspace && yarn install && yarn dev
```

Run from repository root of `workspace` folder:

```bash
yarn build && yarn serve
```

Run style/static checks:

```bash
yarn lint && yarn lint:fix && yarn lint:style
```

Run the proxy server (for API forwarding):

```bash
cd workspace/proxy-server && node server.js
```

Run Docker stack (nginx UI + Node proxy in one container; ports 3232 and 3100):

```bash
cd workspace && docker compose up --build -d
```

## Testing and validation

There is no dedicated automated test suite in this fork baseline. Current validation is:

- `yarn lint` and `yarn lint:style`
- `yarn build`
- Manual scenario checks in Word add-in:
  - chat mode request/response
  - agent mode tool execution
  - quick actions and prompt injection
  - settings persistence and restore

For agent-related changes, execute:

- local `sendMessage`/`applyQuickAction` paths in both ask and agent modes
- failure/fallback path where external services are unavailable
- existing behavior unaffected when new tool providers are disabled

## Code conventions

- TypeScript + Vue composition API (`<script setup lang="ts">`)
- Keep utility functions small and tested by call path inspection
- Use existing naming conventions for settings (camelCase in `localStorage` + `settingPreset`)
- Preserve compatibility with existing local storage keys unless explicitly migrated
- Keep tool schemas explicit and validated before invoking external providers
- Add feature flags where possible (`Issue`-tracked) for remote/provider additions

## Visible Version Marker

- The add-in pane header must show a red visible build marker in place of the old `Assistant` text, formatted exactly as `vX.X.X -- mm.dd.yy`.
- The marker source is `src/utils/appVersion.ts`; the npm package version in `package.json` must match the `appVersion` value.
- Any repo code update must bump `package.json` `version`, update `src/utils/appVersion.ts` `appVersion`, and update `appVersionDate` to the current date in `mm.dd.yy` format.
- Before declaring a LAN add-in update live, verify the Windows/LAN task pane can load the rebuilt bundle and that the visible marker reflects the new version/date.

## LAN Manifest And Word Cache

- For LAN Word add-in deployments, bump the Office add-in manifest identity with `yarn bump:manifest:id` whenever the task pane bundle or manifest-facing behavior changes.
- The canonical Windows catalog manifest is `references/gg-laptop-docx-runtime-apps/manifest.xml`; `workspace/release/self-hosted/manifest.xml` is a symlink to that catalog target, and `workspace/release/self-hosted/manifest.lan.xml` must carry the same `<Id>`.
- Clicking Reload inside the Word task pane is not enough after a manifest identity change. Reopen Word so Office reloads the sideloaded add-in registration.
- Browser visits to `:3232` are useful for checking served assets and network reachability, but they are not a complete substitute for Word-hosted prompt testing.

## Config and settings governance

Primary config surfaces:

- `src/utils/settingForm.ts`, `src/utils/enum.ts`, `src/pages/SettingsPage.vue`
- `src/pages/HomePage.vue` (provider/tool selection and tool merges)

Governance rules:

- Sensitive credentials should remain in runtime/browser-local storage only, unless documented bridge-side design requires secure server-side handling.
- New config keys must include:
  - default value in `settingPreset`
  - persistence behavior in `settingForm`/`settingPreset`
  - clear UI labels in `SettingsPage.vue`
- For new tool or bridge options, record rationale in:
  - `references/issues-list.md`
  - relevant design note (`references/dev-guidelines*.md`)

## Security and policy

- Use explicit host allow-lists in manifest files when introducing external endpoints.
- Avoid wildcard network endpoints for runtime bridges.
- Redact API keys and sensitive headers in any logging/telemetry path.
- External provider toggles should be opt-in by default.

## References in scope (must review before major tool-integration work)

- `references/dev-guidelines.md`
- `references/dev-guidelines-agent.md`
- `references/issues-list.md`
- `references/docsuite-mcp-integration-assessment.md`

## PR and commit expectations

- Keep changes scoped and reversible.
- Include issue number updates when touched logic changes tooling, settings, or persistence behavior.
- Before handoff, update:
  - `references/issues-list.md` status/acceptance
  - any impacted docs in `references/`
- Validate:
  - unchanged core Word/edit flows still work
  - no regression in existing local toolsets

## Quick orientation for future agents

- `src/pages/HomePage.vue`: main runtime path for chat and agent orchestration.
- `src/api/union.ts`: provider instantiation + LangGraph agent stream orchestration.
- `workspace/src/utils/*Tools.ts`: local tools that can be merged with future remote providers.
- `workspace/proxy-server/server.js`: current proxy behavior; extend conservatively.
- `release/*/manifest.xml`: add explicit host/domain allow-list entries only.
- **Canonical sideload manifest:** `references/gg-laptop-docx-runtime-apps/manifest.xml` — `yarn bump:manifest:id` (also `prebuild`) must update `<Id>` on every build; the same Id is propagated to `release/self-hosted/manifest.xml` (Windows catalog symlink) and `manifest.lan.xml`. CI enforces a GUID bump in the references manifest when add-in code changes on push/PR.

---

## Learned architecture — 2026-05-27

### Proxy server constraints
- `workspace/proxy-server/server.js` is a hand-rolled `node:http` server with **zero npm runtime dependencies** (`"type": "module"`, no `node_modules` deps). No Express, Koa, or multer.
- All request body parsing is manual via the internal `getRequestBodyBody()` helper.
- File uploads to the proxy **must use base64-encoded JSON body**, not multipart form data.
- Proxy uses ESM (`"type": "module"`). Any CJS-only packages added as deps require a `createRequire(import.meta.url)` wrapper inside the handler function.
- New routes follow a consistent `handleXxx()` function registered in `handleRequest()`. Route path constants are defined at the top of `server.js`. Existing Memorix / Qdrant / DocSuite / Telemetry handlers are the reference pattern.

### Tool merge function name (correction)
- The actual tool merge function in `src/pages/HomePage.vue` is **`getActiveToolsWithProviders()`**, not `getActiveTools()` as noted elsewhere in this file.

### MCP hub endpoints (local)
- MCP-backed tool routes are browser-facing same-origin `/api/...` routes. The proxy server owns upstream host-service routing to the MCP proxy hub on port `8096`; in the Docker image this defaults to `http://host.docker.internal:8096`.
- Qdrant bridge upstream: MCP JSON-RPC on `/servers/Qdrant_Resources/mcp`.
- DocSuite bridge upstream: MCP JSON-RPC on `/servers/docsuite/mcp`.
- Do not use REST-shaped `/servers/<name>/tools/list` or `/servers/<name>/tools/call` paths for MCP-backed tools; MPH exposes `tools/list` and `tools/call` as JSON-RPC methods on `/mcp`.
- Memorix now has a settings GUI card in `SettingsPage.vue` (General tab), same as Qdrant.

### OpenRouter provider
- OpenRouter is its own first-class provider (`openrouter`), **not** aliased to `official` (OpenAI). It has dedicated `localStorage` keys (`openrouterAPIKey`, etc.) and its own settings block in `settingPreset`.
- OpenRouter's `/models` endpoint is **public** and does not require an API key. `fetchModelList` must not bail early on a missing key when provider is `openrouter`.

### LAN hosting
- `yarn dev:lan` regenerates the LAN manifest (`workspace/release/self-hosted/manifest.lan.xml`) via `workspace/scripts/generate-lan-manifest.js` using the detected host IP, then starts Vite bound to `0.0.0.0:3000`.
- Memorix hook commands must not rely on bash's default PATH; hooks should use the full binary path or invoke via `zsh -c` because Cursor runs hooks in bash which may not see `memorix`.

### WebView2 caveat
- `crypto.randomUUID()` is not reliably available in Word's Office.js WebView2 context. `src/api/union.ts` uses a polyfill/fallback — do not introduce new direct `crypto.randomUUID()` calls in the runtime path.

### Telemetry
- `POST /api/telemetry` endpoint exists on the proxy and writes JSONL to `workspace/logs/`. Events are queued in `sessionStorage` and flushed by `flushTelemetryQueueToProxy` in `generalTools.ts`. LAN PC clients contribute to the same log when the task pane uses the Mac's proxy base URL and `telemetryEnabled` is on.

### Planned: file attachment feature (in-progress as of 2026-05-27)
- A `+` button in the input area will open a file picker; drag-and-drop onto the task pane is also supported.
- Supported types: `.docx` (mammoth, client-side), `.msg` (@kenjiuno/msgreader, client-side), `.pdf` (pdf-parse, proxy-side via new `POST /api/transform`).
- `POST /api/transform` accepts `{ filename, content_base64 }`, converts to markdown, enforces `ATTACHMENT_MAX_CHARS` (default 80 000 chars), returns `{ markdown, charCount, truncated }`.
- New state: `attachedDocuments` ref in `HomePage.vue`. New util: `src/utils/fileParser.ts`. New tools: `createAttachmentTools()` in `generalTools.ts` (listAttachedDocuments + getAttachedDocumentContent).
- Attachments persist across turns until the user explicitly removes them; they are injected alongside selection text in HumanMessage.

## Learned User Preferences

- Canonical Office add-in manifest for GUID bumps is `references/gg-laptop-docx-runtime-apps/manifest.xml`, not `release/self-hosted/` paths alone.
- Prefer one Docker container running nginx (UI) and the Node proxy together with coupled start/stop, not separate services that can drift.
- Apply minimal scoped fixes for lint and validation failures rather than broad refactors.
- Do not commit `.cursor/`, `references/`, `plan`, or `.vscode/`; root `.gitignore` excludes them.

## Learned Workspace Facts

- LAN sideload targets the Mac host (currently `192.168.1.71`): task pane UI on port **3232**, Node proxy on **3100** (`manifest.xml` SourceLocation uses :3232). The task pane should call `/api/...` on its own origin; direct `127.0.0.1` from the task pane resolves to the LAN client, not the Mac host.
- Production Docker: single `word-gpt-plus` container runs nginx (80→host 3232) and Node proxy (3100) via `docker/entrypoint.sh`; compose uses `restart: unless-stopped`.
- Alpine nginx in the Docker image needs `docker/nginx-default.conf`; stock `/etc/nginx/http.d/default.conf` returns 404 for static assets.
- Docker image build runs `./node_modules/.bin/vite build` directly because `prebuild` manifest bump needs `references/` outside the build context.
- Canonical sideload manifest is `references/gg-laptop-docx-runtime-apps/manifest.xml`; it shares an inode with the Windows `appCatalog/manifest.xml` via symlink; `references/` is gitignored so GUID bumps are local—CI verifies via tracked `workspace/release/self-hosted/manifest.lan.xml`.
- `yarn bump:manifest:id` (also `prebuild`) bumps `<Id>` in the canonical manifest and syncs to `release/self-hosted/manifest.xml` and `manifest.lan.xml`; GitHub workflow `manifest-guid.yml` gates push/PR when add-in code changes.
