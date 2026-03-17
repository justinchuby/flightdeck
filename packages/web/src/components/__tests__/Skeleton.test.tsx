import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton, SkeletonCard, SkeletonRow } from '../Skeleton';

describe('Skeleton', () => {
  it('renders with animate-pulse class', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild!.className).toContain('animate-pulse');
  });

  it('applies width and height via inline style', () => {
    const { container } = render(<Skeleton width="100px" height="20px" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('100px');
    expect(el.style.height).toBe('20px');
  });

  it('merges custom className', () => {
    const { container } = render(<Skeleton className="my-custom" />);
    expect(container.firstElementChild!.className).toContain('my-custom');
    expect(container.firstElementChild!.className).toContain('animate-pulse');
  });

  it('has rounded corners', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild!.className).toContain('rounded');
  });
});

describe('SkeletonCard', () => {
  it('renders multiple skeleton children', () => {
    const { container } = render(<SkeletonCard />);
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
  });

  it('has card structure with border and padding', () => {
    const { container } = render(<SkeletonCard />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border');
    expect(card.className).toContain('rounded-lg');
  });

  it('includes a circular avatar skeleton', () => {
    const { container } = render(<SkeletonCard />);
    const rounded = container.querySelector('.rounded-full');
    expect(rounded).toBeInTheDocument();
  });
});

describe('SkeletonRow', () => {
  it('renders multiple skeleton children', () => {
    const { container } = render(<SkeletonRow />);
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
  });

  it('has row layout with flex', () => {
    const { container } = render(<SkeletonRow />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain('flex');
    expect(row.className).toContain('items-center');
  });

  it('includes a circular status dot skeleton', () => {
    const { container } = render(<SkeletonRow />);
    const rounded = container.querySelector('.rounded-full');
    expect(rounded).toBeInTheDocument();
  });
});
