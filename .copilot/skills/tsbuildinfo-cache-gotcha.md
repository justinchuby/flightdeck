# TypeScript .tsbuildinfo Cache Skips Emission When dist/ Is Deleted

**Description:** Use when debugging missing TypeScript build output in composite/incremental projects, especially after cleaning dist/ directories.

## The Problem

When a TypeScript project uses `composite: true` (required for project references), tsc writes a `.tsbuildinfo` file for incremental builds. If you delete the `dist/` directory but leave `.tsbuildinfo` in place, tsc will:

1. Read `.tsbuildinfo` and conclude nothing has changed
2. Exit successfully with code 0
3. **Emit zero files** — dist/ stays empty

This is silent — no warnings, no errors. `tsc --listEmittedFiles` will also show nothing.

## The Fix

Always delete `.tsbuildinfo` before building when you need guaranteed output:

```bash
rm -f tsconfig.tsbuildinfo && tsc
```

Or in package.json:

```json
{
  "scripts": {
    "build:clean": "rm -f tsconfig.tsbuildinfo && tsc"
  }
}
```

## Where This Hits in Flightdeck

- `packages/shared/tsconfig.json` has `composite: true` for project references
- `packages/server` depends on `@flightdeck/shared` which resolves to `packages/shared/dist/`
- In a fresh clone or after `rm -rf dist/`, running `npm run build` in shared would silently produce nothing if `.tsbuildinfo` was stale

## Detection

If `tsc` exits 0 but `dist/` is empty or missing expected files:
1. Check for a `.tsbuildinfo` file in the project root
2. Delete it and rebuild
3. If files now appear, the cache was stale
