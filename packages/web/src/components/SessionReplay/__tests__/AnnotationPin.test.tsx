import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotationPin } from '../AnnotationPin';
import type { ReplayAnnotation } from '../types';

function makeAnnotation(overrides: Partial<ReplayAnnotation> = {}): ReplayAnnotation {
  return {
    id: 'ann-1',
    timestamp: '2025-01-15T10:30:00Z',
    author: 'Alice',
    text: 'This is noteworthy',
    type: 'comment',
    ...overrides,
  };
}

describe('AnnotationPin', () => {
  it('renders at the correct position', () => {
    render(
      <AnnotationPin annotation={makeAnnotation()} position={42} onClick={vi.fn()} />,
    );
    const pin = screen.getByTestId('annotation-pin');
    expect(pin.style.left).toBe('42%');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <AnnotationPin annotation={makeAnnotation()} position={50} onClick={onClick} />,
    );
    fireEvent.click(screen.getByTestId('annotation-pin'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('stops propagation on click', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <AnnotationPin annotation={makeAnnotation()} position={50} onClick={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('annotation-pin'));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('renders tooltip with annotation text and author', () => {
    render(
      <AnnotationPin annotation={makeAnnotation()} position={50} onClick={vi.fn()} />,
    );
    expect(screen.getByText('This is noteworthy')).toBeTruthy();
    expect(screen.getByText('by Alice')).toBeTruthy();
  });

  it('renders correct color for flag type', () => {
    const { container } = render(
      <AnnotationPin
        annotation={makeAnnotation({ type: 'flag' })}
        position={30}
        onClick={vi.fn()}
      />,
    );
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });

  it('renders correct color for bookmark type', () => {
    const { container } = render(
      <AnnotationPin
        annotation={makeAnnotation({ type: 'bookmark' })}
        position={30}
        onClick={vi.fn()}
      />,
    );
    expect(container.querySelector('.bg-blue-400')).toBeTruthy();
  });
});
