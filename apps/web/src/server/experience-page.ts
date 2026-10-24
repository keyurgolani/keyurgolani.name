import 'server-only';
import type { ComponentType } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { VariantRegistry } from '@portfolio/variant-contract';
import { visitorControlModel } from '~/lib/document-appearance';
import { ExperienceDocument, hostLang, type VariantLoader } from '~/lib/experience-document';
import type { SearchParams } from '~/lib/sample';
import { canonicalLocation, isCanonical, sampleQuery, type SampleQuery } from '~/lib/sample-query';
import { REGISTRY } from '~/lib/variants';
import { resolveVisitorPath, type VisitorPath } from '~/lib/visitor-routes';
import { requireDeploymentConfig, servedReference } from './config-store';
import { REFERENCE_PATTERN, SAMPLE_PATTERN, segmentFor } from './experience';
import { getPublicView } from './public-view';
import { resolveRoute } from './routes';
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
// works list's to a case study (#10b), go there. Under demo, /reference
// renders the read-only reference (#9) from the view startup verified,
// with /sample's query rules, its links kept under /reference.

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
    // The demo's read-only reference (#9): its own verified view, which
    // startup built once, in place of the live one, and never the sample's.
    const referenced = decision.entry.pattern === REFERENCE_PATTERN;
    const reference = referenced ? servedReference() : undefined;
    if (referenced && !reference) notFound();
    let path: VisitorPath = { segments, basePath: '' };
    let selection: SampleQuery | null = null;
    let readView = getPublicView;
    // Demo reads its appearance from the query (#19, Slice 4), on /sample
    // and the showroom at /. It goes through the registry first (#9), so no
    // value the registry rejected decides what renders, and the page renders
    // from the canonical query alone. Any other spelling of it answers a 307
    // to the canonical URL on the deployment's own origin. Next still echoes
    // the URL as sent, percent-encoded, in the payloads around the page.
    // Only /sample's and /reference's `variant` picks the composition.
    if (sample || reference || (profile === 'demo' && decision.entry.pattern === '/')) {
      // One read of the live revision, or the reference's view, which the route below renders too.
      const view = reference ? reference.view : await getPublicView();
      readView = async () => view;
      selection = sampleQuery(query, view.site, {
        registered: sample || reference ? registry : [],
      });
      if (!isCanonical(query, selection)) redirect(canonicalLocation(origin, segments, selection));
    }
    if ((sample || reference) && selection) {
      path = {
        segments: segments.slice(1),
        basePath: sample ? '/sample' : '/reference',
        query: selection.query,
        ...(selection.selected === undefined ? {} : { selected: selection.selected }),
      };
    }
    const route = await resolveVisitorPath(path, readView, registry);
    const here = segmentFor(
      { profile, pattern: decision.entry.pattern, segments, query },
      registry,
    );
    const rendered = route.kind === 'render' ? route.composition.rendered.manifest.id : here;
    // From a page, before anything streams, redirect() answers 307.
    if (here !== id || rendered !== id) redirect(`${asked}${query.size > 0 ? `?${query}` : ''}`);
    if (route.kind === 'not-found') notFound();
    if (route.kind === 'redirect') redirect(route.location);
    const appearance = await visitorPageAppearance(
      route.view.site,
      route.composition.rendered.manifest.id,
      selection ? selection.query : search,
      selection?.reduceMotion ?? false,
    );
    const lang = hostLang(route.view);
    return ExperienceDocument({
      unit: route.view,
      selection: route.composition,
      appearance,
      // The slot's control comes back to the page as the visitor asked for it.
      control: {
        model: visitorControlModel(route.view.site, profile, appearance),
        returnTo: `${asked}${query.size > 0 ? `?${query}` : ''}`,
        ...(lang ? { lang } : {}),
      },
      load,
      hostModules,
      linkBase:
        profile === 'demo' && !sample && !reference
          ? { basePath: '/sample' }
          : { basePath: path.basePath, query: path.query },
      route: route.target,
      origin,
      canonical: route.canonical,
    });
  };
}
