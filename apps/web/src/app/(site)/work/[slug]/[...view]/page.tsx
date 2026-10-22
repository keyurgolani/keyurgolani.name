import { servedPage } from '~/server/page-guard';
import { visitorPage } from '~/server/visitor-page';

export const dynamic = 'force-dynamic';

interface WorkViewPageProps {
  readonly params: Promise<{ readonly slug: string; readonly view: string[] }>;
}

// A view under a work, such as /work/<slug>/notes (#5, Slice 4): the 404
// page with its work until #10 resolves slugs.
export default servedPage(
  '/work/[slug]/[...view]',
  async function WorkViewPage({ params }: WorkViewPageProps) {
    const { slug, view } = await params;
    return visitorPage({ segments: ['work', slug, ...view], basePath: '' });
  },
);
