import { servedPage } from '~/server/page-guard';
import { previewPage } from '~/server/preview-page';

export const dynamic = 'force-dynamic';

// A grant's frame (#7, Slice 2): the portfolio the grant renders, at the
// route below the grant, as a visitor gets it. proxy.ts admits only an
// iframe document load for an active grant; anything else under /preview
// never reaches here.
export default servedPage(
  '/preview/[grant]/[[...route]]',
  async function PreviewPage({
    params,
  }: {
    readonly params: Promise<{ readonly grant: string; readonly route?: readonly string[] }>;
  }) {
    const { grant, route } = await params;
    return previewPage(grant, route ?? []);
  },
);
