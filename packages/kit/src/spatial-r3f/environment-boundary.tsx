'use client';

import { Component, Suspense, type ReactNode } from 'react';
import { Environment, type EnvironmentProps } from '@react-three/drei';

interface EnvironmentBoundaryProps {
  preset?: EnvironmentProps['preset'];
  files?: string;
  background?: boolean;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Wraps drei's <Environment /> in an error boundary so failed HDR loads
 * don't crash the entire scene. Renders nothing on error.
 */
export class EnvironmentBoundary extends Component<EnvironmentBoundaryProps, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[EnvironmentBoundary] HDR environment failed to load', error);
    }
  }

  override render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    const { preset, files, background } = this.props;
    return (
      <Suspense fallback={this.props.fallback ?? null}>
        {files ? (
          <Environment files={files} background={background} />
        ) : (
          <Environment preset={preset ?? 'city'} background={background} />
        )}
      </Suspense>
    );
  }
}
