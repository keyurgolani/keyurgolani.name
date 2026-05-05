import Link from 'next/link';
import type { MotionPreference } from '@portfolio/schema';
import { loadPortfolio, loadPortfolioRaw } from '~/lib/portfolio';
import { ThemeToggle } from '~/components/theme-toggle';
import { AdminEditor } from './admin-editor';
import { MotionPanel } from './motion-panel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  let initialSource = '';
  let path = '';
  let format: 'yaml' | 'toml' | 'json' = 'yaml';
  let loadError: string | null = null;
  let activeMotionPreference: MotionPreference = 'respect-os';
  try {
    const loadedRaw = await loadPortfolioRaw();
    initialSource = loadedRaw.source;
    path = loadedRaw.path;
    format = loadedRaw.format;
    const loaded = await loadPortfolio();
    activeMotionPreference = loaded.portfolio.motionPreference;
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
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
        Editing <code>{path || '(no file resolved)'}</code> ({format}). Changes save back to disk
        after schema validation.
      </p>
      {loadError ? <pre className="host-chrome__error">{loadError}</pre> : null}

      <MotionPanel activeMotionPreference={activeMotionPreference} />

      <h2 style={{ marginTop: '2.5rem' }}>Raw editor</h2>
      <AdminEditor initialSource={initialSource} />
    </div>
  );
}
