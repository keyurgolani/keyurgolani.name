import 'server-only';
import { notFound } from 'next/navigation';
import { requireDeploymentConfig } from './config-store';
import { serves, type RoutePattern } from './routes';

/**
 * Pages and metadata routes call this first with their own pattern:
 * notFound() unless the deployment's profile serves the route. This, not
 * proxy.ts, is the authority, and routes.test.ts fails on a route file that
 * skips it. Route handlers use notServed() from route-guard.ts instead.
 */
export function requireServed(pattern: RoutePattern): void {
  if (!serves(requireDeploymentConfig().profile, pattern)) notFound();
}
