import Link from 'next/link';
import type { VariantManifest } from '@portfolio/kit';

interface PreviewBannerProps {
  manifest: VariantManifest;
  colorScheme?: string;
  typography?: string;
}

export function PreviewBanner({ manifest, colorScheme, typography }: PreviewBannerProps) {
  return (
    <div className="preview-banner" role="status">
      <span className="preview-banner__label">Preview</span>
      <span className="preview-banner__variant">{manifest.name}</span>
      {colorScheme ? <span className="preview-banner__chip">scheme: {colorScheme}</span> : null}
      {typography ? <span className="preview-banner__chip">type: {typography}</span> : null}
      <span className="preview-banner__sep" aria-hidden="true" />
      <Link href="/variants" className="preview-banner__link">
        ← Variants
      </Link>
      <Link href="/" className="preview-banner__link">
        Active site →
      </Link>
    </div>
  );
}
