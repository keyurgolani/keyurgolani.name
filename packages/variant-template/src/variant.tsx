import { FallbackSection, MotionPolicyProvider, type VariantProps } from '@portfolio/kit';
import { manifest } from './manifest';
import { ThemeToggleHost } from './theme-toggle';

export default function TemplateVariant({
  portfolio,
  colorScheme,
  typography,
  motionPolicy = 'respect-os',
}: VariantProps) {
  // Every motion hook below reads the site's policy, and the root's
  // data-motion-policy lets the stylesheet reduce CSS motion under `reduce`.
  return (
    <MotionPolicyProvider policy={motionPolicy}>
      <div
        className="vt-root"
        data-variant={manifest.slug}
        data-color-scheme={colorScheme ?? undefined}
        data-typography={typography ?? undefined}
        data-motion-policy={motionPolicy}
      >
        <ThemeToggleHost />
        <main className="vt-page">
          {portfolio.sections.map((section) => (
            <FallbackSection key={section.id} section={section} portfolio={portfolio} />
          ))}
        </main>
      </div>
    </MotionPolicyProvider>
  );
}
