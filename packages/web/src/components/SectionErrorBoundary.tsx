import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { ProvideFeedback } from './ProvideFeedback';

interface Props {
  children: ReactNode;
  /** Label shown in the fallback UI, e.g. "Decisions feed" */
  name?: string;
  /** Extra CSS classes for the fallback container */
  className?: string;
  /** When this value changes, error state auto-resets (e.g. route path) */
  resetKey?: string;
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
 *
 * Pass `resetKey` (e.g. location.pathname) to auto-clear errors on navigation.
 * Or use `<RouteErrorBoundary>` which does this automatically.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: null });
    }
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-th-bg-alt border border-th-border text-th-text-muted hover:text-th-text hover:border-th-border-hover transition-colors"
            >
              <RefreshCw size={12} />
              Retry
            </button>
            <ProvideFeedback
              variant="button"
              context={{
                title: `Error in ${this.props.name ?? 'section'}`,
                errorMessage: this.state.error?.message,
              }}
            />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * SectionErrorBoundary that auto-resets on route changes.
 * Use this for route-level boundaries in App.tsx.
 */
export function RouteErrorBoundary(props: Omit<Props, 'resetKey'>) {
  const { pathname } = useLocation();
  return <SectionErrorBoundary {...props} resetKey={pathname} />;
}
