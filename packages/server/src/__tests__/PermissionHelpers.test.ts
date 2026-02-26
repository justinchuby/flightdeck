import { describe, it, expect } from 'vitest';
import { formatArgs, getToolIconName, getToolSummary } from '../utils/permissionHelpers.js';

describe('Permission Dialog Helpers', () => {
  describe('getToolIconName', () => {
    it('returns shield for undefined toolName', () => {
      expect(getToolIconName(undefined)).toBe('shield');
    });

    it('returns shield for empty string', () => {
      expect(getToolIconName('')).toBe('shield');
    });

    it('returns file for fs/ prefix', () => {
      expect(getToolIconName('fs/write')).toBe('file');
    });

    it('returns file for toolName containing "file"', () => {
      expect(getToolIconName('read_file')).toBe('file');
    });

    it('returns terminal for terminal/ prefix', () => {
      expect(getToolIconName('terminal/run')).toBe('terminal');
    });

    it('returns terminal for toolName containing "command"', () => {
      expect(getToolIconName('run_command')).toBe('terminal');
    });

    it('returns shield for unknown tool names', () => {
      expect(getToolIconName('some_other_tool')).toBe('shield');
    });
  });

  describe('getToolSummary', () => {
    it('returns null for undefined toolName', () => {
      expect(getToolSummary(undefined, { path: '/foo' })).toBeNull();
    });

    it('returns null for undefined args', () => {
      expect(getToolSummary('fs/write', undefined)).toBeNull();
    });

    it('returns null when both are undefined', () => {
      expect(getToolSummary(undefined, undefined)).toBeNull();
    });

    it('returns path for write tools', () => {
      expect(getToolSummary('fs/write', { path: '/src/main.ts' })).toBe('/src/main.ts');
    });

    it('returns command for create tools', () => {
      expect(getToolSummary('create_process', { command: 'npm test' })).toBe('npm test');
    });

    it('returns command if available', () => {
      expect(getToolSummary('run_tool', { command: 'ls -la' })).toBe('ls -la');
    });

    it('returns path as fallback', () => {
      expect(getToolSummary('read_tool', { path: '/etc/config' })).toBe('/etc/config');
    });

    it('returns null when args have no path or command', () => {
      expect(getToolSummary('some_tool', { foo: 'bar' })).toBeNull();
    });
  });

  describe('formatArgs', () => {
    it('returns {} for undefined', () => {
      expect(formatArgs(undefined)).toBe('{}');
    });

    it('returns {} for null', () => {
      expect(formatArgs(null as any)).toBe('{}');
    });

    it('returns {} for non-object', () => {
      expect(formatArgs('string' as any)).toBe('{}');
    });

    it('formats a simple object', () => {
      const result = formatArgs({ key: 'value' });
      expect(result).toBe('{\n  "key": "value"\n}');
    });

    it('truncates long output at 400 chars', () => {
      const longObj: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        longObj[`key_${i}`] = 'a'.repeat(20);
      }
      const result = formatArgs(longObj);
      expect(result.length).toBeLessThanOrEqual(402); // 400 + '\n…'
      expect(result).toContain('…');
    });

    it('does not truncate short output', () => {
      const result = formatArgs({ a: 1 });
      expect(result).not.toContain('…');
    });
  });
});
