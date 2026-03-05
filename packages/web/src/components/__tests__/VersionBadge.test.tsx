import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VersionBadge } from '../VersionBadge';

const originalVersion = globalThis.__APP_VERSION__;
const originalHash = globalThis.__GIT_HASH__;

function setGlobals(version: string, hash: string) {
  (globalThis as any).__APP_VERSION__ = version;
  (globalThis as any).__GIT_HASH__ = hash;
}

beforeEach(() => {
  setGlobals('1.0.0', 'abc1234');
});

afterEach(() => {
  (globalThis as any).__APP_VERSION__ = originalVersion;
  (globalThis as any).__GIT_HASH__ = originalHash;
});

describe('VersionBadge', () => {
  it('renders version with git hash for a stable release', () => {
    setGlobals('1.2.3', 'def5678');
    render(<VersionBadge />);
    expect(screen.getByText('v1.2.3 (def5678)')).toBeDefined();
  });

  it('always shows git hash when available', () => {
    setGlobals('2.0.0', 'aaa1111');
    render(<VersionBadge />);
    const badge = screen.getByText('v2.0.0 (aaa1111)');
    expect(badge).toBeDefined();
  });

  it('shows git hash for dev/pre-release version with hyphen', () => {
    setGlobals('1.2.3-dev', 'abc1234');
    render(<VersionBadge />);
    expect(screen.getByText('v1.2.3-dev (abc1234)')).toBeDefined();
  });

  it('shows git hash for alpha version', () => {
    setGlobals('0.5.0-alpha.1', 'bbb2222');
    render(<VersionBadge />);
    expect(screen.getByText('v0.5.0-alpha.1 (bbb2222)')).toBeDefined();
  });

  it('shows git hash for beta version', () => {
    setGlobals('3.0.0-beta', 'ccc3333');
    render(<VersionBadge />);
    expect(screen.getByText('v3.0.0-beta (ccc3333)')).toBeDefined();
  });

  it('hides hash when git hash is "unknown"', () => {
    setGlobals('1.0.0', 'unknown');
    render(<VersionBadge />);
    expect(screen.getByText('v1.0.0')).toBeDefined();
  });

  it('has a title attribute with full version info', () => {
    setGlobals('1.0.0', 'xyz9999');
    render(<VersionBadge />);
    const badge = screen.getByText('v1.0.0 (xyz9999)');
    expect(badge.getAttribute('title')).toBe('Version 1.0.0 — xyz9999');
  });

  it('renders with muted text styling', () => {
    render(<VersionBadge />);
    const badge = screen.getByText('v1.0.0 (abc1234)');
    expect(badge.className).toContain('text-th-text-muted');
    expect(badge.className).toContain('text-[11px]');
  });
});
