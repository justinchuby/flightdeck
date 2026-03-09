import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Label shown in the fallback UI, e.g. "Decisions feed" */
  name?: string;
  /** Extra CSS classes for the fallback container */
  className?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Lightweight error boundary for individual page sections.
 *
 * Unlike the top-level ErrorBoundary that shows a full-page crash screen,
 * this renders a compact inline fallback so the rest of the page stays
 * functional. Use it around feed sections, sidebar, header, and route
 * content to isolate failures.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`SectionErrorBoundary [${this.props.name ?? 'unnamed'}] caught:`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={`flex flex-col items-center justify-center gap-2 py-6 px-4 text-center ${this.props.className ?? ''}`}>
          <p className="text-sm text-th-text-muted">
            {this.props.name ? `${this.props.name} encountered an error.` : 'This section encountered an error.'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-th-bg-alt border border-th-border text-th-text-muted hover:text-th-text hover:border-th-border-hover transition-colors"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
