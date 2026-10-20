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
// and each axis the query doesn't name is the sample site's own.
export default servedPage('/sample', async function SamplePage({ searchParams }: SamplePageProps) {
  const { appearance } = (await getPublicView()).site;
  const selection = sampleSelection(await searchParams, findManifest, appearance);
  if (!selection) notFound();
  return renderVariant(selection);
});
