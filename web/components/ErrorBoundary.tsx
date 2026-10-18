"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Prevents a render crash from taking down the whole alarm suite. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("App render error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[var(--background)] px-6 text-center text-[var(--foreground)]">
          <p className="text-sm font-semibold">Something went wrong</p>
          <p className="max-w-sm text-xs text-[var(--muted)]">
            The app hit an unexpected error. Your saved alarms on this device are still stored.
          </p>
          <button
            type="button"
            className="btn-premium"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
