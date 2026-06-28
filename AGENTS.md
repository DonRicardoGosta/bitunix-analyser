# Bitunix Futures Analytics — Agent instructions

Analytics terminal for Bitunix USD-M futures: a React SPA served by nginx (prod) or Vite (dev) with reverse-proxy paths to Bitunix and Binance REST APIs.

The analytics SPA is frontend-only. The single exception is the **Challenge engine backend** in `server/` — a Node/TypeScript (Fastify + ws) service that autonomously runs multi-coin trading Challenges (Live or Paper) off the Bitunix WebSocket, persists to SQLite, and serves a `/api` HTTP+WS surface to the Challenge feature. Keep the backend scoped to the Challenge engine; do not migrate other app logic into it.

## Stack

- React 19, TypeScript, Vite 8, Tailwind CSS 4
- Zustand (client state), TanStack Query (async/server state)
- lightweight-charts + Apache ECharts for charts
- React Router 7

## Commands

```bash
npm install
npm run dev      # http://localhost:5173 — proxies /bitunix and /binance
npm run build    # tsc -b && vite build
npm run lint     # ESLint
npm run preview  # preview production build
docker compose up -d --build   # production-like container on :8080
```

## Project layout

```
src/
  features/          # route-level pages and domain UI (analysis, stats, settings)
  components/        # shared layout, charts, UI primitives
  lib/               # exchange clients, indicators, candles, WebSocket helpers
  store/             # Zustand stores (credentials, tickers, favourites, uiPrefs)
  hooks/             # shared React hooks
```

## Architecture constraints

- **No backend logic in the SPA.** All signing, credentials, and business logic for the analytics UI run in the browser. The `server/` Challenge engine is the only backend and is scoped to running Challenges.
- REST goes through `/bitunix/*` and `/binance/*` proxies (Vite dev / nginx prod). WebSockets connect directly (CORS-exempt). The Challenge backend is reached via the `/api` proxy (HTTP + WS).
- SPA API keys live in `localStorage` via `useCredentials` — never log or persist them elsewhere. When a Challenge starts, the SPA forwards keys to the backend, which stores them AES-256-GCM encrypted at rest (never logged).
- `liveTradingEnabled` is a safety gate; real orders require explicit user opt-in. Challenges default to Paper; Live requires the gate.
- Binance panels may show "restricted location" errors; Bitunix features are unaffected.

## Challenge backend (`server/`)

- Stack: Node 22 + TypeScript, Fastify (HTTP) + `ws` (WebSocket), `better-sqlite3`, `zod`.
- Commands: `npm --prefix server run dev | build | start | typecheck` (listens on `PORT`, default `8090`).
- Layout: `bitunix/` (Node REST + WS feed + signing), `db/` (SQLite + repos), `crypto.ts`, `exec/` (Live/Paper engines), `strategy/` (registry + default + per-coin modules), `challenge/` (manager, runner, risk, capital), `events/`, `routes/`, `ws/`.
- Shares domain + contract types with the SPA via `shared/challenge/types.ts` and indicator math via `shared/indicators/`.

## Conventions

- Functional components; named exports for reusable modules, default export only for `App`.
- Co-locate feature code under `src/features/<domain>/`.
- Pure analysis/math in `engine.ts`, `signal.ts`, `patterns.ts`, etc.; UI in `*Tab.tsx`, `*Page.tsx`.
- Use `Panel`, `StatCard`, `Button` from `src/components/ui/primitives.tsx`.
- Use `clsx` for conditional Tailwind classes; dark zinc palette (`zinc-*`, `emerald-*`, `rose-*`).
- Prefer `type` imports (`import type { ... }`) — `verbatimModuleSyntax` is on.
- Keep diffs focused; match existing naming and file structure.

## Before finishing non-trivial changes

1. `npm run lint`
2. `npm run build`
