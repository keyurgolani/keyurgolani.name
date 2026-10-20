import { notFound } from 'next/navigation';
import { findManifest } from '~/lib/registry';
import { renderVariant } from '~/lib/render-variant';
import { servedPage } from '~/server/page-guard';
import { getPublicView } from '~/server/public-view';
import { sampleSelection, type SearchParams } from '~/server/variant-selection';

export const dynamic = 'force-dynamic';

interface SamplePageProps {
  readonly searchParams: Promise<SearchParams>;
}

// The bundled sample in any registered variant (#1, item 17), under `demo`:
// `?variant=<slug>&scheme=<id>&typography=<id>`. An unknown variant is a 404,
// and without one it's the site's variant.
export default servedPage('/sample', async function SamplePage({ searchParams }: SamplePageProps) {
  const { site } = await getPublicView();
  const selection = sampleSelection(await searchParams, findManifest, site.appearance.variant);
  if (!selection) notFound();
  return renderVariant(selection);
});
