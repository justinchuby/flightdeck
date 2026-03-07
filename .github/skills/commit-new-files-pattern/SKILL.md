---
name: commit-new-files-pattern
description: How to ensure new files are included in commits when using the COMMIT command's auto-scoping
---

# Commit New Files Pattern

The COMMIT command only stages files that are locked via LOCK_FILE. New files that aren't locked will be left behind as untracked.

## Rule

**ALWAYS use LOCK_FILE on new files before committing.**

After committing, run `git status` to verify nothing was left behind.

## Why

This pattern caused issues multiple times (ProjectTabs.tsx, commandParser.ts, AcpOutput.tsx) where committed code referenced new files that weren't included in the commit — breaking the build for other developers.

## Checklist

1. Before committing, list all files you created or modified
2. Ensure every file has an active lock via LOCK_FILE
3. Run COMMIT
4. Run `git status` after to verify no untracked files remain that should have been committed
