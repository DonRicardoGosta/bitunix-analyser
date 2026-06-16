# Bitunix Futures Analytics — Agent instructions

Frontend-only analytics terminal for Bitunix USD-M futures. No database, no app backend — a React SPA served by nginx (prod) or Vite (dev) with reverse-proxy paths to Bitunix and Binance REST APIs.

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

- **No backend logic.** All signing, credentials, and business logic run in the browser.
- REST goes through `/bitunix/*` and `/binance/*` proxies (Vite dev / nginx prod). WebSockets connect directly (CORS-exempt).
- API keys live in `localStorage` via `useCredentials` — never log or persist them elsewhere.
- `liveTradingEnabled` is a safety gate; real orders require explicit user opt-in.
- Binance panels may show "restricted location" errors; Bitunix features are unaffected.

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
