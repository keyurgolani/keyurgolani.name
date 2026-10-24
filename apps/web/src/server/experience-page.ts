import 'server-only';
import type { ComponentType } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { VariantRegistry } from '@portfolio/variant-contract';
import { visitorControlModel } from '~/lib/document-appearance';
import { ExperienceDocument, hostLang, type VariantLoader } from '~/lib/experience-document';
import { sampleSelection, type SearchParams } from '~/lib/sample';
import { REGISTRY } from '~/lib/variants';
import { resolveVisitorPath, type VisitorPath } from '~/lib/visitor-routes';
import { requireDeploymentConfig } from './config-store';
import { SAMPLE_PATTERN, segmentFor } from './experience';
import { getPublicView } from './public-view';
import { resolveRoute } from './routes';
import { liveSchemeSheets, liveStylesheets } from './generated-schemes';
import { visitorPageAppearance } from './visitor-appearance';

// Every visitor page renders through here (#5, Slice 4; #6, Slice 2), in the
// experience segment of the variant it renders: registry generation writes
// app/(site)/%5Fexperience/<id>/[[...route]]/page.tsx for each registered
// variant, which hands this its own loader and its own client host modules,
// and next.config.ts rewrites every GET or HEAD of a visitor page there, to
// the segment proxy.ts names. The segments below /_experience/<id> are the
// path the visitor asked for, and the query is theirs as sent.
//
// The page asks the route table about that path again, as proxy.ts did, and
// reads the live revision. Then it asks segmentFor() which segment the
// request belongs in, which reads the live composition config-store holds:
// the value proxy.ts read, which the reader has just refreshed. When the
// revision changed in between, or its composition isn't this segment's, it
// answers a 307 to the same URL, and proxy.ts marks that request for the
// right segment. Both pick the fallback composition for a work's own page
// that the composition leaves to the host (lib/work-page.ts, #10b), so they
// agree there too. Otherwise it renders the route: a view of the composition,
// a 307 to the canonical route of a view only another installed variant
// declares, or the 404 page. demo's root shows the sample, and demo serves
// the sample's routes under /sample alone, so the root's links, such as a
// works list's to a case study (#10b), go there.

interface ExperienceProps {
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

/** The path the visitor asked for, spelled as a URL path again. */
function pathOf(segments: readonly string[]): string {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

/**
 * The page of the experience segment of `id`: what its route file renders,
 * with `load`, the import() of `id`'s package, and `hostModules`, the
 * segment's own client module. Tests pass a registry of their own.
 */
export function experiencePage(
  id: string,
  load: VariantLoader,
  hostModules: ComponentType,
  registry: VariantRegistry = REGISTRY,
) {
  return async function ExperiencePage({ params, searchParams }: ExperienceProps) {
    const { profile, origin } = requireDeploymentConfig();
    const segments = (await params).route ?? [];
    const search = await searchParams;
    const query = queryOf(search);
    const asked = pathOf(segments);
    // The page proxy.ts rewrote here: one of the table's visitor pages,
    // which this profile serves.
    const decision = resolveRoute(profile, asked, query);
    if (decision.status !== 'served' || !decision.entry.experience) notFound();
    const sample = decision.entry.pattern === SAMPLE_PATTERN;
    let path: VisitorPath;
    if (sample) {
      const selection = sampleSelection(search, registry);
      if (selection === null) notFound();
      path = { segments: segments.slice(1), basePath: '/sample', ...selection };
    } else {
      path = { segments, basePath: '' };
    }
    const route = await resolveVisitorPath(path, getPublicView, registry);
    const here = segmentFor(
      { profile, pattern: decision.entry.pattern, segments, query },
      registry,
    );
    const rendered = route.kind === 'render' ? route.composition.rendered.manifest.id : here;
    // From a page, before anything streams, redirect() answers 307.
    if (here !== id || rendered !== id) redirect(`${asked}${query.size > 0 ? `?${query}` : ''}`);
    if (route.kind === 'not-found') notFound();
    if (route.kind === 'redirect') redirect(route.location);
    // The live revision's stored generated schemes (#20 PR 3), never a
    // draft's, and their stylesheets, which the boundary links from
    // /_portfolio/scheme/ and the control preloads.
    const live = await liveSchemeSheets();
    const { schemes } = live;
    const stylesheets = liveStylesheets(live);
    const appearance = await visitorPageAppearance(
      route.view.site,
      route.composition.rendered.manifest.id,
      search,
      schemes,
    );
    const lang = hostLang(route.view);
    return ExperienceDocument({
      unit: route.view,
      selection: route.composition,
      appearance,
      stylesheets,
      // The slot's control comes back to the page as the visitor asked for it.
      control: {
        model: visitorControlModel(
          route.view.site,
          profile,
          appearance,
          undefined,
          schemes,
          stylesheets,
        ),
        returnTo: `${asked}${query.size > 0 ? `?${query}` : ''}`,
        ...(lang ? { lang } : {}),
      },
      load,
      hostModules,
      linkBase:
        profile === 'demo' && !sample
          ? { basePath: '/sample' }
          : { basePath: path.basePath, query: path.query },
      route: route.target,
      origin,
      canonical: route.canonical,
    });
  };
}
