import { servedPage } from '~/server/page-guard';
import { visitorPage } from '~/server/visitor-page';

export const dynamic = 'force-dynamic';

// The site's home: its variant, or the fallback composition when this build
// doesn't register it.
export default servedPage('/', async function HomePage() {
  return visitorPage({ segments: [], basePath: '' });
});
