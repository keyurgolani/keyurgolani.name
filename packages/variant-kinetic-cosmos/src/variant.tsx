import {
  deriveNavItems,
  MotionPolicyProvider,
  resolveColorScheme,
  resolveTypographyPreset,
  type VariantProps,
} from '@portfolio/kit';
import { manifest } from './manifest';
import { SectionDispatch } from './section';
import { KineticCosmosThemeToggle } from './primitives/theme-toggle';
import { AnimatedBackground } from './primitives/animated-background';
import { Navigation } from './primitives/navigation';

export default function KineticCosmosVariant({
  portfolio,
  colorScheme,
  typography,
  motionPolicy = 'respect-os',
}: VariantProps) {
  const scheme = resolveColorScheme(manifest, colorScheme);
  const type = resolveTypographyPreset(manifest, typography);
  const navItems = deriveNavItems(portfolio, { limit: 8 });

  return (
    <MotionPolicyProvider policy={motionPolicy}>
      <div
        className="kc-root"
        data-variant={manifest.slug}
        data-color-scheme={scheme ?? undefined}
        data-typography={type ?? undefined}
        data-motion-policy={motionPolicy}
      >
        <a className="kc-skip-link" href="#main">
          Skip to content
        </a>
        <AnimatedBackground />
        <Navigation items={navItems} brand={portfolio.identity.name} />
        <KineticCosmosThemeToggle />
        <main id="main" className="kc-page">
          {portfolio.sections.map((section) => (
            <SectionDispatch key={section.id} section={section} portfolio={portfolio} />
          ))}
        </main>
      </div>
    </MotionPolicyProvider>
  );
}
