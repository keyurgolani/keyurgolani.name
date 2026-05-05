'use client';

import { useTheme } from '@portfolio/kit';

const OPTIONS: Array<{ value: 'light' | 'dark' | 'system'; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

/**
 * Minimal theme toggle. Replace this with whatever fits the variant's
 * visual language — a sun/moon icon button, a dropdown, a sidebar entry.
 */
export function ThemeToggleHost() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="vt-theme-toggle" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={preference === opt.value}
          data-active={preference === opt.value}
          onClick={() => setPreference(opt.value)}
          className="vt-theme-toggle__option"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
