# DRY Options Pattern for Formatter Functions

**Description:** Use when consolidating multiple similar formatting functions into one. Applies to any case where 2-3 functions share 80%+ logic but differ in output format or filtering.

## The Pattern

When you find multiple functions that:
- Read from the same data source
- Iterate the same way
- Differ only in formatting, filtering, or header/footer text

Consolidate into one function with an options object:

```typescript
export interface CommandHelpOptions {
  /** Output format: 'verbose' shows full details; 'compact' is one-liner per item. */
  format?: 'verbose' | 'compact';
  /** Filter parameter — e.g., role-based filtering. */
  role?: string;
}

export function buildCommandHelp(options?: CommandHelpOptions): string {
  const format = options?.format ?? 'verbose';
  // ... shared logic with format-conditional branches
}
```

## Applied Example: CommandHelp.ts

**Before (3 functions):**
- `buildCommandHelp()` — verbose, no role filter
- `buildCommandReminder(role?)` — compact, with role filter
- `buildCommandReminderMessage(role?)` — trivial wrapper

**After (1 function):**
- `buildCommandHelp(options?)` — `format` controls verbose/compact, `role` controls filtering
- Callers: `buildCommandHelp()` for errors, `buildCommandHelp({ format: 'compact', role })` for reminders

## Checklist

1. Identify shared data source and iteration logic
2. List the differences between functions (format, filtering, headers/footers)
3. Design options interface with sensible defaults (most common use = no args)
4. Move filtering logic inside the function gated by options
5. Update all callers — trivial wrappers become direct calls
6. Remove the duplicates entirely
7. Update tests to cover both format paths
