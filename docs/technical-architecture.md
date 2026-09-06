# Technical Architecture

Technology choices, rules, and architectural decisions for mist.

## Platform

Everything runs on Cloudflare. No other hosting, no external databases, no separate asset storage.

- **Cloudflare Workers** — single worker serving the entire application.
- **Durable Objects** — each markdown document is a Durable Object holding persistent state. Uses SQLite storage (built-in to Durable Objects).
- **No auth** at this stage. Will be added later.

## Framework Stack

- **React Router 7** — SSR enabled, serving from Cloudflare Workers. Uses `v8_viteEnvironmentApi` and `v8_middleware` future flags.
- **Cloudflare Agents SDK** — wrapper around the project providing agent routing. Agents are Durable Objects with a higher-level API for real-time WebSocket connections.
- **Vite** — build tooling with `@cloudflare/vite-plugin`, `@tailwindcss/vite`, `@react-router/dev/vite`, and `vite-tsconfig-paths`.
- **Tailwind CSS 4** — styling.
- **TypeScript** — strict type checking.
- **TipTap 3** — multiplayer markdown editor. Core technology for the document editing experience. Backed by Durable Object persistent state via Yjs.

## Directory Structure

```
agents/       Server-side Durable Object agents
app/          React Router application
  components/ Shared UI components
  lib/        Utilities, editor logic, Yjs provider
  routes/     File-based routing
  shared/     Constants and types shared between client and server
docs/         Project documentation
workers/      Cloudflare Worker entry point (workers/app.ts)
tests/        Test suite
plans/        Working plans
skills/       Skill documents for AI coding assistants
```

## Critical Rule: Server/Client Separation

Client-side React components must **never** import from the `agents/` directory — not even constants, types, or enums. If both client and server need shared types/constants, put them in `app/shared/`.

This is the most common source of build errors. The Cloudflare Workers environment (server) and the browser (client) are separate runtimes.

## Worker Entry Point Pattern

The worker entry at `workers/app.ts` handles requests in this order:

1. `routeAgentRequest(request, env)` — handles `/agents/:agent/:name` WebSocket and HTTP requests to agents.
2. React Router SSR — handles everything else.

Agents are exported from the worker entry file and configured as Durable Object bindings in `wrangler.jsonc`.

## Key Configuration

- `wrangler.jsonc` — Cloudflare Workers config for any instance: no domains, no instance vars, deploys to workers.dev as-is. Must include `"nodejs_compat"` in compatibility flags (required by Agents SDK for `async_hooks`). Set `CLOUDFLARE_ACCOUNT_ID` env var for deployment. Instance-specific configs live in `deploy/*.jsonc` and are selected at build time with `WRANGLER_CONFIG`; the full walkthrough (local run, first deploy, domain, sign-in, vars) is `docs/self-hosting.md`.
- `react-router.config.ts` — SSR enabled with `v8_viteEnvironmentApi` and `v8_middleware` future flags.
- `vite.config.ts` — plugins: cloudflare, tailwindcss, reactRouter, tsconfigPaths.
- `vitest.config.ts` — test config with coverage thresholds.

## Documentation

- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare Agents SDK: https://developers.cloudflare.com/agents/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- React Router 7: https://reactrouter.com/
- TipTap: https://tiptap.dev/
- Yjs: https://yjs.dev/
