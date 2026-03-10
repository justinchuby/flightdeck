---
name: release-process
description: >
  Step-by-step release process for Flightdeck, based on v0.3.0.
  Covers code cleanup, versioning, changelog, testing, and publishing.
---

# Flightdeck Release Process

Step-by-step process for shipping a release, based on v0.3.0.

## Pre-Release Checklist

### 1. Code Cleanup
- [ ] Remove `console.log` in new code (`grep -rn 'console\.log' packages/web/src/ packages/server/src/`)
- [ ] Check for `TODO` / `FIXME` comments that should be addressed
- [ ] Remove unused imports in recently modified files
- [ ] Verify removed features are fully cleaned up (no orphan imports)

### 2. Test Suite
- [ ] Run full web tests: `cd packages/web && npx vitest run`
- [ ] Run full server tests: `cd packages/server && npx vitest run`
- [ ] Fix any NEW test failures. Pre-existing failures are documented in `infrastructure.md`.
- [ ] Note total test counts for release notes.

### 3. TypeScript
- [ ] `cd packages/web && npx tsc --noEmit` — must be 0 errors
- [ ] `cd packages/server && npx tsc --noEmit` — filter known pre-existing errors

### 4. Production Build
- [ ] `npm run build` from repo root — must succeed
- [ ] Check for chunk size warnings (non-blocking but worth noting)

### 5. Version Bump
- [ ] Update `version` in all 4 `package.json` files:
  - Root `package.json`
  - `packages/server/package.json`
  - `packages/web/package.json`
  - `packages/docs/package.json`
- [ ] Update CHANGELOG.md: change `## Unreleased` header to `## [X.Y.Z] - YYYY-MM-DD`

### 6. QA Sweep
- [ ] QA tests all pages: Lead Dashboard, Overview, Agents, Tasks, Timeline, Canvas, Mission Control, Analytics, Settings
- [ ] QA verifies new features work end-to-end
- [ ] QA confirms removed features are gone
- [ ] QA documents non-blocking issues (P2/P3)
- [ ] QA gives GO / NO-GO sign-off

### 7. Documentation
- [ ] CHANGELOG.md has all entries (Added, Changed, Removed, Fixed)
- [ ] README.md feature list is current
- [ ] DEVELOPER_GUIDE.md reflects new/removed components and APIs
- [ ] Skill files updated with learnings

## Release

### 8. Tagging

> **⛔ HARD RULE: NEVER touch git tags — no create, no delete, no push. Tags are 100% user-managed. Only prepare version bumps in package.json and CHANGELOG updates. This caused an issue when v0.3.0 tag was pushed by an agent — user had to bump to 0.3.1. No exceptions.**

Your job ends at version bump + CHANGELOG. User handles tagging.

## CHANGELOG Format

```markdown
## [0.3.0] - 2026-03-06

### Added
- **Feature name** — one-line description

### Changed
- **What changed** — description

### Removed
- **What was removed** — why

### Fixed
- **What was fixed** — root cause
```

## Coordination (Multi-Agent)

When multiple agents are working on release prep:
1. One developer handles version bump + CHANGELOG header
2. Another handles test fixes + code cleanup
3. QA runs comprehensive page sweep with screenshots
4. Tech writer reviews documentation
5. Use a group chat (e.g., `v030-crew`) to coordinate
6. Your job ends at version bump + CHANGELOG — user handles tagging

## Post-Release

- [ ] Update any external documentation or announcements
- [ ] Create `## Unreleased` section in CHANGELOG.md for next cycle
