import type { Portfolio } from '@portfolio/schema';
import { deriveNavItems, resolveColorScheme, resolveTypographyPreset } from '@portfolio/kit';
import { manifest } from './manifest';
import { SectionDispatch } from './section';
import { KineticCosmosThemeToggle } from './primitives/theme-toggle';
import { AnimatedBackground } from './primitives/animated-background';
import { Navigation } from './primitives/navigation';

interface VariantProps {
  portfolio: Portfolio;
  colorScheme?: string;
  typography?: string;
}

export default function KineticCosmosVariant({ portfolio, colorScheme, typography }: VariantProps) {
  const scheme = resolveColorScheme(manifest, colorScheme, portfolio.colorScheme);
  const type = resolveTypographyPreset(manifest, typography, portfolio.typography);
  const navItems = deriveNavItems(portfolio, { limit: 8 });

  return (
    <div
      className="kc-root"
      data-variant={manifest.slug}
      data-color-scheme={scheme ?? undefined}
      data-typography={type ?? undefined}
    >
      <a className="kc-skip-link" href="#main">
        Skip to content
      </a>
      <AnimatedBackground />
      <Navigation items={navItems} brand={portfolio.identity.name} />
      <KineticCosmosThemeToggle />
      <main id="main" className="kc-page">
        {portfolio.sections.map((section, i) => (
          <SectionDispatch
            key={section.id ?? `${section.kind}-${i}`}
            section={section}
            portfolio={portfolio}
          />
        ))}
      </main>
    </div>
  );
}
