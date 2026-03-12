// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getProviderColors } from '../providerColors';

describe('getProviderColors', () => {
  it('returns purple for copilot', () => {
    const colors = getProviderColors('copilot');
    expect(colors.bg).toContain('purple');
    expect(colors.text).toContain('purple');
    expect(colors.border).toContain('purple');
  });

  it('returns blue for gemini', () => {
    const colors = getProviderColors('gemini');
    expect(colors.bg).toContain('blue');
    expect(colors.text).toContain('blue');
    expect(colors.border).toContain('blue');
  });

  it('returns amber for claude', () => {
    const colors = getProviderColors('claude');
    expect(colors.bg).toContain('amber');
    expect(colors.text).toContain('amber');
    expect(colors.border).toContain('amber');
  });

  it('returns green for codex', () => {
    const colors = getProviderColors('codex');
    expect(colors.bg).toContain('green');
    expect(colors.text).toContain('green');
    expect(colors.border).toContain('green');
  });

  it('returns cyan for cursor', () => {
    const colors = getProviderColors('cursor');
    expect(colors.bg).toContain('cyan');
    expect(colors.text).toContain('cyan');
    expect(colors.border).toContain('cyan');
  });

  it('returns zinc for opencode', () => {
    const colors = getProviderColors('opencode');
    expect(colors.bg).toContain('zinc');
    expect(colors.text).toContain('zinc');
    expect(colors.border).toContain('zinc');
  });

  it('is case-insensitive', () => {
    const colors = getProviderColors('Gemini');
    expect(colors.bg).toContain('blue');
  });

  it('returns default zinc for unknown providers', () => {
    const colors = getProviderColors('unknown-provider');
    expect(colors.bg).toContain('zinc');
    expect(colors.text).toContain('zinc');
    expect(colors.border).toContain('zinc');
  });

  it('returns default for undefined', () => {
    const colors = getProviderColors(undefined);
    expect(colors.bg).toContain('zinc');
  });

  it('returns all three color properties', () => {
    const colors = getProviderColors('copilot');
    expect(colors).toHaveProperty('bg');
    expect(colors).toHaveProperty('text');
    expect(colors).toHaveProperty('border');
  });
});
