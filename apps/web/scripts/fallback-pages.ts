// The pages a running app shows only when something fails (#19, Slice 4),
// rendered from their own code for tests/e2e/focus-ring.spec.ts: the site's
// error page, in the fallback boundary the site's layout hands it, and the
// static 503. Playwright compiles the JSX it loads for component tests, so
// the spec runs this through tsx from apps/web, as the host's unit tests
// run, and reads one JSON line: { error, unavailable }, each the page's HTML.
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorPage from '../src/app/(site)/error';
import { FallbackBoundaryProvider } from '../src/app/_chrome/fallback-boundary';
import { fallbackBoundary } from '../src/lib/fallback-boundary';
import { unavailablePage } from '../src/server/unavailable-page';

const Provider = FallbackBoundaryProvider as ComponentType<{
  readonly value: ReturnType<typeof fallbackBoundary>;
  readonly children?: ReactNode;
}>;

const error = renderToStaticMarkup(
  createElement(
    Provider,
    { value: fallbackBoundary() },
    createElement(ErrorPage, {
      error: Object.assign(new Error('canary'), { digest: '4021974117' }),
    }),
  ),
);

process.stdout.write(`${JSON.stringify({ error, unavailable: unavailablePage() })}\n`);
