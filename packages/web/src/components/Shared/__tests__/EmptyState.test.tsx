import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeTruthy();
  });

  it('renders icon when provided', () => {
    render(<EmptyState icon="🔍" title="No results" />);
    expect(screen.getByText('🔍')).toBeTruthy();
  });

  it('does not render icon when not provided', () => {
    const { container } = render(<EmptyState title="No results" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Try adding some items" />);
    expect(screen.getByText('Try adding some items')).toBeTruthy();
  });

  it('renders action button and calls onClick', () => {
    const onClick = vi.fn();
    render(
      <EmptyState title="Empty" action={{ label: 'Add Item', onClick }} />,
    );
    const btn = screen.getByText('Add Item');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders children content', () => {
    render(
      <EmptyState title="Empty">
        <span data-testid="custom-child">Custom content</span>
      </EmptyState>,
    );
    expect(screen.getByTestId('custom-child')).toBeTruthy();
  });

  it('has role="status" on container', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('applies compact styling when compact is true', () => {
    const { container } = render(<EmptyState title="Empty" compact />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('py-8');
  });

  it('applies default spacing when compact is false', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('py-16');
  });
});
