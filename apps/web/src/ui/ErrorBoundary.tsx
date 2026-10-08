import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Last line of defence: a plain page with a way back instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>The page stopped working. Your saved scans are still on this device.</p>
        <p className="mono crash-msg">{this.state.error.message.slice(0, 300)}</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload the page
        </button>
      </div>
    );
  }
}
