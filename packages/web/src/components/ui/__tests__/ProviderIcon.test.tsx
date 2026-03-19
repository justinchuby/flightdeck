// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProviderIcon } from '../ProviderIcon';

describe('ProviderIcon', () => {
  it('renders SVG img when iconUrl is provided', () => {
    render(
      <ProviderIcon
        provider={{ icon: '🐙', iconUrl: '/provider-icons/copilot.svg', name: 'Copilot' }}
      />,
    );
    const img = screen.getByRole('img', { name: 'Copilot' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/provider-icons/copilot.svg');
  });

  it('falls back to emoji icon when no iconUrl', () => {
    render(
      <ProviderIcon provider={{ icon: '🟠', name: 'Claude' }} />,
    );
    expect(screen.getByText('🟠')).toBeInTheDocument();
  });

  it('uses fallback when provider is undefined', () => {
    render(<ProviderIcon provider={undefined} />);
    expect(screen.getByText('🔧')).toBeInTheDocument();
  });

  it('uses custom fallback', () => {
    render(<ProviderIcon provider={undefined} fallback="🔌" />);
    expect(screen.getByText('🔌')).toBeInTheDocument();
  });

  it('passes className to img element', () => {
    render(
      <ProviderIcon
        provider={{ icon: '🐙', iconUrl: '/icons/test.svg', name: 'Test' }}
        className="w-8 h-8"
      />,
    );
    const img = screen.getByRole('img', { name: 'Test' });
    expect(img).toHaveClass('w-8', 'h-8');
  });
});
