import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Component imports ───────────────────────────────────────────────────────

import { EmptyState } from '../Shared/EmptyState';
import { SkeletonCard, SkeletonList } from '../Shared/SkeletonCard';
import { ErrorPage } from '../Shared/ErrorPage';

// ── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 4 Cycle 5 — Shared Components', () => {

  // ── EmptyState ────────────────────────────────────────────────────────
  describe('Shared — EmptyState', () => {
    it('renders icon, title, and description', () => {
      render(<EmptyState icon="📭" title="No items" description="Nothing here yet." />);
      expect(screen.getByText('📭')).toBeInTheDocument();
      expect(screen.getByText('No items')).toBeInTheDocument();
      expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
    });

    it('renders action button that fires onClick', () => {
      const onClick = vi.fn();
      render(
        <EmptyState icon="📭" title="No items" action={{ label: 'Add item', onClick }} />,
      );
      const btn = screen.getByText('Add item');
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('omits action button when no action prop is passed', () => {
      render(<EmptyState icon="📭" title="No items" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  // ── SkeletonCard ──────────────────────────────────────────────────────
  describe('Shared — SkeletonCard', () => {
    it('renders with animate-pulse class', () => {
      const { container } = render(<SkeletonCard />);
      const card = container.firstElementChild!;
      expect(card.className).toContain('animate-pulse');
    });

    it('renders default 3 skeleton lines', () => {
      const { container } = render(<SkeletonCard />);
      // lines inside the space-y-2 container
      const lines = container.querySelectorAll('.space-y-2 > div');
      expect(lines.length).toBe(3);
    });

    it('renders custom number of lines', () => {
      const { container } = render(<SkeletonCard lines={5} />);
      const lines = container.querySelectorAll('.space-y-2 > div');
      expect(lines.length).toBe(5);
    });

    it('SkeletonList renders specified count of cards', () => {
      const { container } = render(<SkeletonList count={4} />);
      const cards = container.querySelectorAll('[aria-busy="true"][aria-hidden="true"]');
      expect(cards.length).toBe(4);
    });
  });

  // ── ErrorPage ─────────────────────────────────────────────────────────
  describe('Shared — ErrorPage', () => {
    it('renders default title when none provided', () => {
      render(<ErrorPage />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('renders custom title, message, and detail', () => {
      render(
        <ErrorPage
          title="Not Found"
          message="The page you requested does not exist."
          detail="GET /api/missing returned 404"
        />,
      );
      expect(screen.getByText('Not Found')).toBeInTheDocument();
      expect(screen.getByText('The page you requested does not exist.')).toBeInTheDocument();
      expect(screen.getByText('GET /api/missing returned 404')).toBeInTheDocument();
    });

    it('renders Retry button that fires onRetry', () => {
      const onRetry = vi.fn();
      render(<ErrorPage onRetry={onRetry} />);
      const btn = screen.getByText('Retry');
      fireEvent.click(btn);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders Go to Dashboard button that fires onGoHome', () => {
      const onGoHome = vi.fn();
      render(<ErrorPage onGoHome={onGoHome} />);
      const btn = screen.getByText('Go to Dashboard');
      fireEvent.click(btn);
      expect(onGoHome).toHaveBeenCalledTimes(1);
    });

    it('renders status code when provided', () => {
      render(<ErrorPage statusCode={404} title="Not Found" />);
      expect(screen.getByText('404')).toBeInTheDocument();
    });
  });
});
