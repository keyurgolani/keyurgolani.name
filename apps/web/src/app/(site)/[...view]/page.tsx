import { servedPage } from '~/server/page-guard';
import { visitorPage } from '~/server/visitor-page';

export const dynamic = 'force-dynamic';

interface ViewPageProps {
  readonly params: Promise<{ readonly view: string[] }>;
}

// A path view of the site's variant, such as /chapters/<chapter> (#5, Slice
// 4). A path only another installed variant declares redirects home, and
// anything else is the 404 page. Static routes, /api, and the metadata
// routes all win over this one.
export default servedPage('/[...view]', async function ViewPage({ params }: ViewPageProps) {
  return visitorPage({ segments: (await params).view, basePath: '' });
});
