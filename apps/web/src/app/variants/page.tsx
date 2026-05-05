import Link from 'next/link';
import { loadPortfolio } from '~/lib/portfolio';
import { listManifests, isExperimental } from '~/lib/registry';
import { ThemeToggle } from '~/components/theme-toggle';
import { VariantPicker, type VariantSummary } from './variant-picker';

export const dynamic = 'force-dynamic';

export default async function VariantsPage() {
  let activeSlug = 'editorial';
  let activeColorScheme: string | null = null;
  let activeTypography: string | null = null;
  try {
    const { portfolio } = await loadPortfolio();
    activeSlug = portfolio.variant;
    activeColorScheme = portfolio.colorScheme ?? null;
    activeTypography = portfolio.typography ?? null;
  } catch {
    // ignore
  }

  const manifests = listManifests();
  const summaries: VariantSummary[] = manifests.map((m) => ({
    slug: m.slug,
    name: m.name,
    tagline: m.tagline,
    description: m.description,
    author: m.author,
    version: m.version,
    aesthetic: m.aesthetic,
    motion: m.motion,
    density: m.density,
    typography: m.typography,
    bestFor: m.bestFor ? [...m.bestFor] : [],
    supportedKinds: [...m.supportedKinds],
    themes: [...m.themes],
    colorSchemes: m.colorSchemes ? [...m.colorSchemes] : [],
    typographyPresets: m.typographyPresets ? [...m.typographyPresets] : [],
    experimental: isExperimental(m.slug),
  }));

  return (
    <div className="host-chrome">
      <nav className="host-chrome__nav">
        <Link href="/">View site</Link>
        <Link href="/admin">Admin</Link>
        <Link href="/variants" aria-current="page">
          Variants
        </Link>
        <span style={{ marginLeft: 'auto' }}>
          <ThemeToggle />
        </span>
      </nav>
      <h1>Variants</h1>
      <p>
        {summaries.length} variant{summaries.length === 1 ? '' : 's'} registered. Filter by aesthetic,
        motion, typography, or density. Click any card to preview. Color scheme and typography
        options live on the active variant.
      </p>
      <VariantPicker
        activeSlug={activeSlug}
        variants={summaries}
        activeColorScheme={activeColorScheme}
        activeTypography={activeTypography}
      />
    </div>
  );
}
