'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ColorScheme, TypographyPreset } from '@portfolio/kit';

interface VariantCustomizerProps {
  variantSlug: string;
  colorSchemes: ColorScheme[];
  typographyPresets: TypographyPreset[];
  activeColorScheme: string | null;
  activeTypography: string | null;
}

/**
 * In-card customizer for the *active* variant. Lets the user pick a color
 * scheme and typography preset shipped by that variant. Hidden when the
 * variant doesn't ship multiple options.
 */
export function VariantCustomizer({
  variantSlug,
  colorSchemes,
  typographyPresets,
  activeColorScheme,
  activeTypography,
}: VariantCustomizerProps) {
  const [scheme, setScheme] = useState(activeColorScheme ?? '');
  const [typography, setTypography] = useState(activeTypography ?? '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const showSchemes = colorSchemes.length > 1;
  const showTypography = typographyPresets.length > 1;
  if (!showSchemes && !showTypography) return null;

  const dirty =
    (showSchemes && scheme !== (activeColorScheme ?? '')) ||
    (showTypography && typography !== (activeTypography ?? ''));

  async function apply() {
    setError(null);
    setSuccess(null);
    const payload: Record<string, string | null | undefined> = {};
    if (showSchemes && scheme !== (activeColorScheme ?? '')) {
      payload.colorScheme = scheme || null;
    }
    if (showTypography && typography !== (activeTypography ?? '')) {
      payload.typography = typography || null;
    }
    const res = await fetch('/api/customize', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' }));
      setError(data.error ?? `HTTP ${res.status}`);
      return;
    }
    setSuccess('Saved.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="variant-customizer">
      {showSchemes ? (
        <div className="variant-customizer__row">
          <span className="variant-customizer__label">Scheme</span>
          <div className="variant-customizer__swatches">
            {colorSchemes.map((s) => (
              <button
                key={s.id}
                type="button"
                className="variant-customizer__swatch"
                data-active={s.id === scheme}
                onClick={() => setScheme(s.id)}
                title={`${s.name}${s.description ? ` — ${s.description}` : ''}`}
                disabled={pending}
              >
                {s.swatch ? (
                  <span className="variant-customizer__swatch-dots">
                    <span style={{ background: s.swatch.paper ?? '#fff' }} />
                    <span style={{ background: s.swatch.ink ?? '#000' }} />
                    <span style={{ background: s.swatch.accent ?? '#888' }} />
                  </span>
                ) : null}
                <span className="variant-customizer__swatch-name">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showTypography ? (
        <div className="variant-customizer__row">
          <span className="variant-customizer__label">Type</span>
          <select
            value={typography}
            disabled={pending}
            onChange={(e) => setTypography(e.target.value)}
            className="variant-customizer__select"
          >
            {typographyPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? <pre className="host-chrome__error">{error}</pre> : null}
      {success ? <p className="host-chrome__success">{success}</p> : null}

      <div className="variant-customizer__actions">
        <button
          type="button"
          className="host-chrome__button"
          onClick={apply}
          disabled={!dirty || pending}
        >
          {pending ? 'Applying…' : 'Apply'}
        </button>
        <a
          href={`/preview/${variantSlug}${scheme ? `?scheme=${scheme}` : ''}${typography ? `&typography=${typography}` : ''}`}
          className="host-chrome__button"
          target="_blank"
          rel="noopener noreferrer"
        >
          Preview combo →
        </a>
      </div>
    </div>
  );
}
