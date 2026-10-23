import 'server-only';
import type { Metadata } from 'next';
import type { VariantRegistry } from '@portfolio/variant-contract';
import { experienceHead } from '~/lib/experience-head';
import type { SearchParams } from '~/lib/sample';
import { REGISTRY } from '~/lib/variants';
import { resolveVisitorPath } from '~/lib/visitor-routes';
import { requireDeploymentConfig } from './config-store';
import { SAMPLE_PATTERN } from './experience';
import { getPublicView } from './public-view';
import { resolveRoute } from './routes';

// A visitor page's own head metadata (#22): what the site's layout gives
// every page, from the live revision, with `og:url` on the route's
// canonical path. Each experience segment's page exports it as its
// generateMetadata, beside the page experience-page.ts renders, which links
// the same path as its canonical. The path is the route itself at the site
// root, and a path view's parent route; a page under /sample names none,
// since it isn't the live site's. A path that renders nothing, a 404 or a
// redirect, adds nothing to what the layout gives.

interface MetadataProps {
  readonly params: Promise<{ readonly route?: readonly string[] }>;
  readonly searchParams: Promise<SearchParams>;
}

/** The request's query, as the route table reads it. */
function queryOf(params: SearchParams): URLSearchParams {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const each of [value ?? []].flat()) query.append(name, each);
  }
  return query;
}

/** generateMetadata for an experience segment's page. Tests pass a registry of their own. */
export function experienceMetadata(registry: VariantRegistry = REGISTRY) {
  return async function generateMetadata({
    params,
    searchParams,
  }: MetadataProps): Promise<Metadata> {
    const { profile, origin } = requireDeploymentConfig();
    const segments = (await params).route ?? [];
    const asked = `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
    const decision = resolveRoute(profile, asked, queryOf(await searchParams));
    if (decision.status !== 'served' || !decision.entry.experience) return {};
    if (decision.entry.pattern === SAMPLE_PATTERN) return {};
    const route = await resolveVisitorPath({ segments, basePath: '' }, getPublicView, registry);
    if (route.kind !== 'render') return {};
    return experienceHead(route.view, origin, { path: route.canonical }).metadata;
  };
}
