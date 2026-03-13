# Monorepo predev Script Pattern for Shared Packages

**Description:** Use when fixing "module not found" errors for `@flightdeck/shared` during development, or when setting up dev scripts in npm workspace monorepos.

## The Problem

In this monorepo:
- `packages/shared` exports from `dist/` (compiled TypeScript)
- `packages/server` dev script uses `tsx watch` which transpiles on-the-fly
- But `tsx` resolves `@flightdeck/shared` via the npm workspace symlink → `packages/shared/dist/`
- In a fresh environment, `dist/` doesn't exist → `ERR_MODULE_NOT_FOUND`

## The Solution

Add `predev` scripts that build shared before starting the dev server:

**Root package.json:**
```json
{
  "scripts": {
    "predev": "npm run build:shared",
    "build:shared": "cd packages/shared && rm -f tsconfig.tsbuildinfo && npm run build",
    "dev": "node scripts/dev.mjs",
    "predev:server": "npm run build:shared"
  }
}
```

**packages/server/package.json:**
```json
{
  "scripts": {
    "predev": "cd ../shared && rm -f tsconfig.tsbuildinfo && npm run build",
    "dev": "tsx watch src/index.ts"
  }
}
```

## Key Details

- npm automatically runs `predev` before `dev` and `predev:server` before `dev:server`
- Always `rm -f tsconfig.tsbuildinfo` before building (see tsbuildinfo-cache-gotcha skill)
- From `packages/server/`, use `cd ../shared && npm run build` (not `--workspace` — that doesn't work from child dirs)
- `--workspace=packages/shared` only works from the monorepo root
