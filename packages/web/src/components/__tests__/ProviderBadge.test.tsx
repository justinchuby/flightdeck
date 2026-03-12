// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ProviderBadge } from '../ProviderBadge';

afterEach(cleanup);

describe('ProviderBadge', () => {
  it('renders nothing when provider is undefined', () => {
    const { container } = render(<ProviderBadge provider={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders provider name', () => {
    render(<ProviderBadge provider="copilot" />);
    expect(screen.getByText('copilot')).toBeDefined();
  });

  it('applies provider-specific color classes', () => {
    render(<ProviderBadge provider="gemini" />);
    const el = screen.getByText('gemini');
    expect(el.className).toContain('blue');
  });

  it('uses sm size by default', () => {
    render(<ProviderBadge provider="claude" />);
    const el = screen.getByText('claude');
    expect(el.className).toContain('text-[9px]');
    expect(el.className).toContain('shrink-0');
  });

  it('uses md size when specified', () => {
    render(<ProviderBadge provider="codex" size="md" />);
    const el = screen.getByText('codex');
    expect(el.className).toContain('text-xs');
    expect(el.className).not.toContain('text-[9px]');
  });

  it('appends custom className', () => {
    render(<ProviderBadge provider="cursor" className="ml-2" />);
    const el = screen.getByText('cursor');
    expect(el.className).toContain('ml-2');
  });

  it('renders for each known provider', () => {
    const providers = ['copilot', 'gemini', 'claude', 'codex', 'cursor', 'opencode'];
    for (const p of providers) {
      const { unmount } = render(<ProviderBadge provider={p} />);
      expect(screen.getByText(p)).toBeDefined();
      unmount();
    }
  });
});
