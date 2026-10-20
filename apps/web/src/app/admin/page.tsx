import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MotionPreference } from '@portfolio/schema';
import { authoringRoutesEnabled } from '~/lib/authoring';
import { loadPortfolio, loadPortfolioRaw } from '~/lib/portfolio';
import { ThemeToggle } from '~/components/theme-toggle';
import { AdminEditor } from './admin-editor';
import { MotionPanel } from './motion-panel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  if (!authoringRoutesEnabled()) notFound();
  let initialSource = '';
  let format: 'yaml' | 'toml' | 'json' = 'yaml';
  let loadFailed = false;
  let activeMotionPreference: MotionPreference = 'respect-os';
  try {
    const loadedRaw = await loadPortfolioRaw();
    initialSource = loadedRaw.source;
    format = loadedRaw.format;
    const loaded = await loadPortfolio();
    activeMotionPreference = loaded.portfolio.motionPreference;
  } catch (e) {
    // The message can carry the absolute file path (ENOENT does), so it goes
    // to the server log only.
    console.error('[admin] Could not load the portfolio file:', e);
    loadFailed = true;
  }

  return (
    <div className="host-chrome">
      <nav className="host-chrome__nav">
        <Link href="/">View site</Link>
        <Link href="/admin" aria-current="page">
          Admin
        </Link>
        <Link href="/variants">Variants</Link>
        <span style={{ marginLeft: 'auto' }}>
          <ThemeToggle />
        </span>
      </nav>
      <h1>Edit portfolio</h1>
      <p>
        Editing the portfolio file ({format}). Changes save back to disk after schema validation.
      </p>
      {loadFailed ? (
        <p className="host-chrome__error">Could not load the portfolio file. See the server log.</p>
      ) : null}

      <MotionPanel activeMotionPreference={activeMotionPreference} />

      <h2 style={{ marginTop: '2.5rem' }}>Raw editor</h2>
      <AdminEditor initialSource={initialSource} />
    </div>
  );
}
