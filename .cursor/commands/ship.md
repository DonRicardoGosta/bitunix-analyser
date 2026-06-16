---
name: ship
description: Lint, build, and summarize changes before merge
---

# Ship checklist

Run before merging or opening a PR.

## 1. Quality gates

```bash
npm run lint
npm run build
```

Both must pass with zero errors.

## 2. Sanity checks

- No API keys, secrets, or `.env` files committed.
- No edits to `dist/` or `node_modules/`.
- New routes wired in `src/App.tsx` if a page was added.
- Proxy paths (`/bitunix`, `/binance`) unchanged unless intentionally updating infra.

## 3. PR summary

Write a concise summary covering:
- **What** changed (user-visible behavior)
- **Why** (motivation or bug fixed)
- **How to test** (steps or `npm run dev` + which page to open)

Use Conventional Commits for the PR title: `feat(scope): description` or `fix(scope): description`.
