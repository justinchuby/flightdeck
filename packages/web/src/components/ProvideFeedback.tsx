/**
 * Reusable component for submitting feedback via GitHub Issues.
 * Can be dropped into any error state or used standalone.
 */
import { Bug, ExternalLink } from 'lucide-react';

const GITHUB_ISSUE_URL = 'https://github.com/justinchuby/flightdeck/issues/new';
const ISSUE_TEMPLATE = 'user-feedback.yml';
const ISSUE_LABELS = 'user-feedback';

interface FeedbackContext {
  /** Short context for the issue title, e.g. "Session resume failed" */
  title?: string;
  /** Error message or details for the issue body */
  errorMessage?: string;
  /** Session or agent ID for debugging */
  sessionId?: string;
}

/** Build a GitHub issue URL with pre-filled fields. */
export function buildFeedbackUrl(ctx: FeedbackContext = {}): string {
  const params = new URLSearchParams();
  params.set('template', ISSUE_TEMPLATE);
  params.set('labels', ISSUE_LABELS);

  if (ctx.title) {
    params.set('title', ctx.title);
  }

  const bodyParts: string[] = [];
  if (ctx.errorMessage) {
    bodyParts.push(`**Error:** ${ctx.errorMessage}`);
  }
  if (ctx.sessionId) {
    bodyParts.push(`**Session ID:** \`${ctx.sessionId}\``);
  }
  bodyParts.push(`**Timestamp:** ${new Date().toISOString()}`);

  if (bodyParts.length > 0) {
    params.set('body', bodyParts.join('\n'));
  }

  return `${GITHUB_ISSUE_URL}?${params.toString()}`;
}

interface ProvideFeedbackProps {
  /** Context to pre-fill the GitHub issue */
  context?: FeedbackContext;
  /** Visual variant */
  variant?: 'inline' | 'button';
  /** Additional CSS classes */
  className?: string;
}

/**
 * Renders a link/button to submit feedback via GitHub Issues.
 *
 * - `inline` (default): compact text link for embedding in error messages
 * - `button`: styled button for standalone use
 */
export function ProvideFeedback({ context, variant = 'inline', className = '' }: ProvideFeedbackProps) {
  const url = buildFeedbackUrl(context);

  if (variant === 'button') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-th-bg-alt border border-th-border text-th-text-muted hover:text-th-text hover:border-th-border-hover transition-colors ${className}`}
        data-testid="provide-feedback"
      >
        <Bug size={12} />
        Provide Feedback
        <ExternalLink size={10} className="opacity-50" />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-xs text-th-text-muted hover:text-accent underline underline-offset-2 transition-colors ${className}`}
      data-testid="provide-feedback"
    >
      <Bug size={10} />
      Provide Feedback
    </a>
  );
}

/**
 * Compact icon-only button for the sidebar/nav — opens GitHub issue page.
 */
export function SubmitIssueButton({ className = '' }: { className?: string }) {
  const url = buildFeedbackUrl({ title: 'User feedback' });

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg w-[58px] transition-colors text-th-text-muted hover:text-accent hover:bg-accent/10 ${className}`}
      title="Submit Issue"
      data-testid="sidebar-submit-issue"
    >
      <Bug size={18} />
      <span className="text-[11px] leading-tight font-medium truncate w-full text-center">Issue</span>
    </a>
  );
}
