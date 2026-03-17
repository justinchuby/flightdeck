import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DropOverlay } from '../DropOverlay';

describe('DropOverlay', () => {
  it('renders "Drop file to attach" text', () => {
    render(<DropOverlay />);
    expect(screen.getByText('Drop file to attach')).toBeInTheDocument();
  });

  it('has pointer-events-none to avoid intercepting drops', () => {
    const { container } = render(<DropOverlay />);
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toContain('pointer-events-none');
  });

  it('has dashed border styling', () => {
    const { container } = render(<DropOverlay />);
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toContain('border-dashed');
    expect(overlay.className).toContain('border-accent');
  });

  it('is absolutely positioned for full-pane coverage', () => {
    const { container } = render(<DropOverlay />);
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toContain('absolute');
    expect(overlay.className).toContain('inset-0');
  });
});
