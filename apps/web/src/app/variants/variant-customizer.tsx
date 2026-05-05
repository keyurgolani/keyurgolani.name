'use client';

import type { ColorScheme, TypographyPreset } from '@portfolio/kit';

interface VariantCustomizerProps {
  colorSchemes: ColorScheme[];
  typographyPresets: TypographyPreset[];
  scheme: string;
  typography: string;
  onSchemeChange: (id: string) => void;
  onTypographyChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * Pure controlled picker — scheme + typography swatches/select. State and
 * persistence live on the parent VariantCard; this component renders only.
 * Returns null when the variant ships a single scheme + single preset
 * (nothing to choose).
 */
export function VariantCustomizer({
  colorSchemes,
  typographyPresets,
  scheme,
  typography,
  onSchemeChange,
  onTypographyChange,
  disabled,
}: VariantCustomizerProps) {
  const showSchemes = colorSchemes.length > 1;
  const showTypography = typographyPresets.length > 1;
  if (!showSchemes && !showTypography) return null;

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
                onClick={() => onSchemeChange(s.id)}
                title={`${s.name}${s.description ? ` — ${s.description}` : ''}`}
                disabled={disabled}
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
            disabled={disabled}
            onChange={(e) => onTypographyChange(e.target.value)}
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
    </div>
  );
}
