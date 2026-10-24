import 'server-only';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireDeploymentConfig } from './config-store';
import { serves, type RoutePattern } from './routes';

// The guard every page and metadata route goes through (#1, item 13). This,
// not proxy.ts, is the authority. Route handlers use served() from
// route-guard.ts.

const SERVED = Symbol.for('keyurgolani.portfolio.served-route');

/**
 * A page's or a metadata route's default export that calls notFound()
 * unless the deployment's profile serves `pattern`. Every one is
 * `export default servedPage('<its pattern>', render)`, and routes.test.ts
 * fails on any other form.
 */
export function servedPage<Args extends unknown[], Result>(
  pattern: RoutePattern,
  render: (...args: Args) => Result,
): (...args: Args) => Result {
  const guarded = (...args: Args): Result => {
    if (!serves(requireDeploymentConfig().profile, pattern)) notFound();
    return render(...args);
  };
  return Object.assign(guarded, { [SERVED]: pattern });
}

/**
 * A page's generateMetadata that adds nothing, and reads nothing, unless
 * the deployment's profile serves `pattern` (#22), as the page's servedPage()
 * renders nothing then. A page exports one as
 * `export const generateMetadata = servedMetadata('<its pattern>', metadata)`.
 */
export function servedMetadata<Args extends unknown[]>(
  pattern: RoutePattern,
  metadata: (...args: Args) => Promise<Metadata>,
): (...args: Args) => Promise<Metadata> {
  const guarded = async (...args: Args): Promise<Metadata> =>
    serves(requireDeploymentConfig().profile, pattern) ? metadata(...args) : {};
  return Object.assign(guarded, { [SERVED]: pattern });
}
