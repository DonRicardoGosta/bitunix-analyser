---
name: run-checks
description: Run lint and production build for this Vite React app. Use after code changes or before marking work complete.
---

# Run checks

Validate that changes type-check, lint clean, and build successfully.

## Steps

1. Install dependencies if needed: `npm install`
2. Lint: `npm run lint`
3. Build: `npm run build` (runs `tsc -b && vite build`)
4. If either fails, fix the reported issues and re-run until both pass.

## What to report

- Pass/fail for lint and build
- File paths and line numbers for any errors
- Brief summary of fixes applied

## Notes

- ESLint has `react-hooks/set-state-in-effect` and `purity` disabled — do not re-enable without team agreement.
- Build errors from `noUnusedLocals` mean dead imports or variables must be removed.
