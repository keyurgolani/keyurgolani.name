import { requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';
import { AppearanceFixtures } from '../../_components/appearance-fixtures';

// /_fixtures/appearance (#19, Slice 3): every shared primitive in each of
// its states, in the page's own document boundary, and plates holding other
// selections, for tests/appearance. The folder's %5F is how Next spells a
// segment that starts with an underscore. The route table serves the page
// only in a build made with APPEARANCE_FIXTURES=1, in every profile; any
// other build answers it as a path no route matches. It renders fixture
// content only, never the portfolio.

export const metadata = { title: 'Appearance fixtures' };

type Query = Promise<Record<string, string | string[] | undefined>>;

async function Fixtures({ searchParams }: { searchParams: Query }) {
  const query = await searchParams;
  return <AppearanceFixtures profile={requireDeploymentConfig().profile} query={query} />;
}

export default servedPage('/_fixtures/appearance', Fixtures);
