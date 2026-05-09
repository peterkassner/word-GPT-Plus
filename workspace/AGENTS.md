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

Run Docker service stack (frontend + proxy):

```bash
cd workspace && docker compose up --build
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
