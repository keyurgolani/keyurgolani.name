import { notFound } from 'next/navigation';
import { sampleSelection, type SearchParams } from '~/lib/sample';
import { servedPage } from '~/server/page-guard';
import { visitorPage } from '~/server/visitor-page';

export const dynamic = 'force-dynamic';

interface SamplePageProps {
  readonly params: Promise<{ readonly path?: string[] }>;
  readonly searchParams: Promise<SearchParams>;
}

// The bundled sample (#1, item 17), under `demo`, with its routes below
// /sample (#5, Slice 4): the sample site's own selection, or `?variant=<id>`
// for any variant this build registers, which every link and redirect keeps.
// The fallback composition and an unknown id are a 404.
export default servedPage(
  '/sample/[[...path]]',
  async function SamplePage({ params, searchParams }: SamplePageProps) {
    const sample = sampleSelection(await searchParams);
    if (sample === null) notFound();
    return visitorPage({ segments: (await params).path ?? [], basePath: '/sample', ...sample });
  },
);
