import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorPage } from '../ErrorPage';

describe('ErrorPage', () => {
  it('renders default title when none provided', () => {
    render(<ErrorPage />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('renders custom title, message, and detail', () => {
    render(
      <ErrorPage
        title="Not Found"
        message="The page does not exist."
        detail="GET /foo returned 404"
      />,
    );
    expect(screen.getByText('Not Found')).toBeTruthy();
    expect(screen.getByText('The page does not exist.')).toBeTruthy();
    expect(screen.getByText('GET /foo returned 404')).toBeTruthy();
  });

  it('displays status code when provided', () => {
    render(<ErrorPage statusCode={404} />);
    expect(screen.getByText('404')).toBeTruthy();
  });

  it('does not render status code when not provided', () => {
    render(<ErrorPage />);
    expect(screen.queryByText('404')).toBeNull();
  });

  it('renders Retry button and calls onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorPage onRetry={onRetry} />);
    const btn = screen.getByText('Retry');
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders Go to Dashboard button and calls onGoHome', () => {
    const onGoHome = vi.fn();
    render(<ErrorPage onGoHome={onGoHome} />);
    const btn = screen.getByText('Go to Dashboard');
    fireEvent.click(btn);
    expect(onGoHome).toHaveBeenCalledOnce();
  });

  it('has role="alert" on the container', () => {
    render(<ErrorPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
