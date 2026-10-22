import { servedPage } from '~/server/page-guard';
import { visitorPage } from '~/server/visitor-page';

export const dynamic = 'force-dynamic';

interface WorkPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

// A work's page (#5, Slice 4): the 404 page until #10 resolves slugs to work.
export default servedPage('/work/[slug]', async function WorkPage({ params }: WorkPageProps) {
  return visitorPage({ segments: ['work', (await params).slug], basePath: '' });
});
