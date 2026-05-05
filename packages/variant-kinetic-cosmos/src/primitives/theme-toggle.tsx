'use client';

import { useTheme } from '@portfolio/kit';
import { manifest } from '../manifest';

type Pref = 'light' | 'dark' | 'bright' | 'black' | 'system';

const ALL_OPTIONS: Array<{ value: Pref; label: string; symbol: string }> = [
  { value: 'light', label: 'Light', symbol: '☀' },
  { value: 'dark', label: 'Dark', symbol: '☾' },
  { value: 'bright', label: 'Bright', symbol: '✦' },
  { value: 'black', label: 'Black', symbol: '⬤' },
  { value: 'system', label: 'Auto', symbol: '⊙' },
];

export function KineticCosmosThemeToggle() {
  const { preference, setPreference } = useTheme();
  const supported = new Set(manifest.themes);
  const visible = ALL_OPTIONS.filter(
    (opt) => opt.value === 'system' || supported.has(opt.value),
  );
  return (
    <div className="kc-theme-toggle" role="radiogroup" aria-label="Theme">
      {visible.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={preference === opt.value}
          data-active={preference === opt.value}
          onClick={() => setPreference(opt.value)}
          className="kc-theme-toggle__option"
          title={opt.label}
        >
          <span aria-hidden="true">{opt.symbol}</span>
          <span className="sr-only">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
