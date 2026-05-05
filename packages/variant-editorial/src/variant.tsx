import type { Portfolio } from '@portfolio/schema';
import { deriveNavItems, resolveColorScheme, resolveTypographyPreset } from '@portfolio/kit';
import { manifest } from './manifest';
import { SectionDispatch } from './section';
import { EditorialThemeToggle } from './primitives/theme-toggle';
import { TableOfContents } from './primitives/table-of-contents';

interface VariantProps {
  portfolio: Portfolio;
  colorScheme?: string;
  typography?: string;
}

export default function EditorialVariant({ portfolio, colorScheme, typography }: VariantProps) {
  const scheme = resolveColorScheme(manifest, colorScheme, portfolio.colorScheme);
  const type = resolveTypographyPreset(manifest, typography, portfolio.typography);
  const navItems = deriveNavItems(portfolio, { limit: 9 });
  const showToc = navItems.length >= 2;

  return (
    <div
      className="editorial-root"
      data-variant="editorial"
      data-color-scheme={scheme ?? undefined}
      data-typography={type ?? undefined}
      data-toc={showToc || undefined}
    >
      <a className="editorial-skip-link" href="#main">
        Skip to content
      </a>
      {showToc ? (
        <TableOfContents items={navItems} brand={portfolio.identity.name} />
      ) : null}
      <EditorialThemeToggle />
      <main id="main" className="editorial-page">
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
