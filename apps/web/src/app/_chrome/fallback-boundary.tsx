'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { FallbackBoundaryData } from '../../lib/fallback-boundary';

// The fallback packs' boundary for the site's error page (#19, Slice 4),
// which is a client component and can't read the registry: the site's
// layout passes the boundary's data down, and the error page renders its
// content inside it, with its skip link to the page's main.

const FallbackBoundaryContext = createContext<FallbackBoundaryData | null>(null);

/** What the site's layout wraps its pages in, so the error page finds the fallback boundary. */
export function FallbackBoundaryProvider({
  value,
  children,
}: {
  readonly value: FallbackBoundaryData;
  readonly children: ReactNode;
}) {
  return <FallbackBoundaryContext value={value}>{children}</FallbackBoundaryContext>;
}

/** `children` in the fallback packs' document boundary, or as they are with no layout to hand it down. */
export function FallbackBoundary({
  main,
  children,
}: {
  /** The id of the page's main, which the skip link goes to. */
  readonly main: string;
  readonly children: ReactNode;
}) {
  const data = useContext(FallbackBoundaryContext);
  if (!data) return <>{children}</>;
  return (
    <>
      {data.stylesheets.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="appearance" />
      ))}
      <div {...data.attributes}>
        <a data-ui-slot="skip-link" href={`#${main}`}>
          Skip to content
        </a>
        {children}
      </div>
    </>
  );
}
