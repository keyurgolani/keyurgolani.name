import {
  deriveNavItems,
  MotionPolicyProvider,
  resolveColorScheme,
  resolveTypographyPreset,
  type VariantProps,
} from '@portfolio/kit';
import { manifest } from './manifest';
import { SectionDispatch } from './section';
import { EditorialThemeToggle } from './primitives/theme-toggle';
import { TableOfContents } from './primitives/table-of-contents';

export default function EditorialVariant({
  portfolio,
  colorScheme,
  typography,
  motionPolicy = 'respect-os',
}: VariantProps) {
  const scheme = resolveColorScheme(manifest, colorScheme);
  const type = resolveTypographyPreset(manifest, typography);
  const navItems = deriveNavItems(portfolio, { limit: 9 });
  const showToc = navItems.length >= 2;

  return (
    <MotionPolicyProvider policy={motionPolicy}>
      <div
        className="editorial-root"
        data-variant="editorial"
        data-color-scheme={scheme ?? undefined}
        data-typography={type ?? undefined}
        data-motion-policy={motionPolicy}
        data-toc={showToc || undefined}
      >
        <a className="editorial-skip-link" href="#main">
          Skip to content
        </a>
        {showToc ? <TableOfContents items={navItems} brand={portfolio.identity.name} /> : null}
        <EditorialThemeToggle />
        <main id="main" className="editorial-page">
          {portfolio.sections.map((section) => (
            <SectionDispatch key={section.id} section={section} portfolio={portfolio} />
          ))}
        </main>
      </div>
    </MotionPolicyProvider>
  );
}
