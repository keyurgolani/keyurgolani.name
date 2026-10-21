import { notFound } from 'next/navigation';
import { renderComposition } from '~/lib/render-composition';
import { sampleVariant, type SearchParams } from '~/lib/variants';
import { requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';
import { getPublicView } from '~/server/public-view';

export const dynamic = 'force-dynamic';

interface SamplePageProps {
  readonly searchParams: Promise<SearchParams>;
}

// The bundled sample (#1, item 17), under `demo`: the sample site's own
// selection, or `?variant=<id>` for any variant this build registers. The
// fallback composition and an unknown id are a 404.
export default servedPage('/sample', async function SamplePage({ searchParams }: SamplePageProps) {
  const view = await getPublicView();
  const selected = sampleVariant(await searchParams, view.site.appearance.variant);
  if (selected === null) notFound();
  return renderComposition({
    view,
    selected,
    route: { route: 'home' },
    basePath: '/sample',
    origin: requireDeploymentConfig().origin,
  });
});
