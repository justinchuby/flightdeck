import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProvideFeedback, SubmitIssueButton, buildFeedbackUrl } from '../ProvideFeedback';

describe('buildFeedbackUrl', () => {
  it('returns base URL with template and labels', () => {
    const url = buildFeedbackUrl();
    expect(url).toContain('https://github.com/justinclarkxyz/ai-crew/issues/new');
    expect(url).toContain('template=user-feedback.yml');
    expect(url).toContain('labels=user-feedback');
  });

  it('includes title when provided', () => {
    const url = buildFeedbackUrl({ title: 'Session resume failed' });
    expect(url).toContain('title=Session+resume+failed');
  });

  it('includes error message and session ID in body', () => {
    const url = buildFeedbackUrl({
      errorMessage: 'Connection refused',
      sessionId: 'abc-123',
    });
    expect(url).toContain('Error');
    expect(url).toContain('Connection+refused');
    expect(url).toContain('abc-123');
    expect(url).toContain('Timestamp');
  });
});

describe('ProvideFeedback', () => {
  it('renders inline variant by default', () => {
    render(<ProvideFeedback />);
    const link = screen.getByTestId('provide-feedback');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href');
    expect(link.getAttribute('href')).toContain('issues/new');
    expect(screen.getByText('Provide Feedback')).toBeDefined();
  });

  it('renders button variant', () => {
    render(<ProvideFeedback variant="button" />);
    const link = screen.getByTestId('provide-feedback');
    expect(link.className).toContain('bg-th-bg-alt');
  });

  it('passes context to URL', () => {
    render(<ProvideFeedback context={{ title: 'Bug report', errorMessage: 'Oops' }} />);
    const link = screen.getByTestId('provide-feedback');
    expect(link.getAttribute('href')).toContain('title=Bug+report');
    expect(link.getAttribute('href')).toContain('Oops');
  });
});

describe('SubmitIssueButton', () => {
  it('renders with correct structure', () => {
    render(<SubmitIssueButton />);
    const link = screen.getByTestId('sidebar-submit-issue');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('href')).toContain('issues/new');
    expect(screen.getByText('Issue')).toBeDefined();
  });
});
