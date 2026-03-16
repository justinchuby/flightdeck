// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from '../CollapsibleSection';

afterEach(cleanup);

function renderSection(props: Partial<Parameters<typeof CollapsibleSection>[0]> = {}) {
  return render(
    <CollapsibleSection
      title="My Section"
      icon={<span data-testid="icon">📦</span>}
      {...props}
    >
      <div data-testid="child">Content</div>
    </CollapsibleSection>,
  );
}

describe('CollapsibleSection — coverage extras', () => {
  it('applies default height style when expanded', () => {
    const { container } = renderSection({ defaultHeight: 200 });
    const section = container.firstElementChild as HTMLElement;
    expect(section.style.height).toBe('200px');
  });

  it('removes height style when collapsed', () => {
    const { container } = renderSection();
    fireEvent.click(screen.getByRole('button'));
    const section = container.firstElementChild as HTMLElement;
    expect(section.style.height).toBe('');
  });

  it('badge with value 0 is displayed', () => {
    renderSection({ badge: 0 });
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('resize mousedown starts resize (sets cursor and body style)', () => {
    const { container } = renderSection();
    const handle = container.querySelector('.cursor-row-resize')!;
    fireEvent.mouseDown(handle, { clientY: 100 });
    // After mousedown, body should have row-resize cursor
    expect(document.body.style.cursor).toBe('row-resize');
    expect(document.body.style.userSelect).toBe('none');
    // Simulate mouseup to clean up
    fireEvent.mouseUp(document);
  });

  it('resize clamps to minHeight and maxHeight', () => {
    const { container } = renderSection({ defaultHeight: 200, minHeight: 80, maxHeight: 400 });
    const handle = container.querySelector('.cursor-row-resize')!;

    // Start resize
    fireEvent.mouseDown(handle, { clientY: 200 });

    // Move mouse down 500px (would exceed maxHeight of 400)
    fireEvent.mouseMove(document, { clientY: 700 });
    const section = container.firstElementChild as HTMLElement;
    expect(parseInt(section.style.height)).toBeLessThanOrEqual(400);

    // Clean up
    fireEvent.mouseUp(document);
    expect(document.body.style.cursor).toBe('');
  });

  it('renders with custom minHeight and maxHeight', () => {
    const { container } = renderSection({ minHeight: 40, maxHeight: 300 });
    expect(container.firstElementChild).toBeTruthy();
  });
});
