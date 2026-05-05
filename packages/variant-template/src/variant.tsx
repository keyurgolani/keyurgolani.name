import type { Portfolio } from '@portfolio/schema';
import { FallbackSection } from '@portfolio/kit';
import { manifest } from './manifest';
import { ThemeToggleHost } from './theme-toggle';

interface VariantProps {
  portfolio: Portfolio;
  colorScheme?: string;
  typography?: string;
}

export default function TemplateVariant({ portfolio, colorScheme, typography }: VariantProps) {
  return (
    <div
      className="vt-root"
      data-variant={manifest.slug}
      data-color-scheme={colorScheme ?? undefined}
      data-typography={typography ?? undefined}
    >
      <ThemeToggleHost />
      <main className="vt-page">
        {portfolio.sections.map((section, i) => (
          <FallbackSection
            key={section.id ?? `${section.kind}-${i}`}
            section={section}
            portfolio={portfolio}
          />
        ))}
      </main>
    </div>
  );
}
