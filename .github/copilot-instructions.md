# Cross-Platform Compatibility

All code in this repository must work on Windows, macOS, and Linux.

## Path Handling
- Use `path.join()` or `path.resolve()` for file paths — never hardcode `/` or `\` separators.
- Use `os.tmpdir()`, `os.homedir()` instead of hardcoded paths like `/tmp` or `~`.
- Don't assume case-sensitive file systems.

## Shell Commands
- Never use Unix-only commands (`which`, `chmod`, `ln -s`) without providing a Windows equivalent.
- For binary/command detection, use the shared `isBinaryAvailable()` from `utils/platform.ts`.
- Use `process.platform === 'win32'` checks when platform-specific behavior is unavoidable.

## Process Execution
- Use `child_process.execFile()` instead of `exec()` with shell strings when possible — it's safer and more portable.
- Prefer cross-platform npm packages over shell scripts.

## Testing
- Consider both forward slashes and backslashes in path handling.
- Don't assume case-sensitive file systems.
