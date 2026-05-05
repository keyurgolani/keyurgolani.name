'use client';

import { useTheme } from '@portfolio/kit';

const OPTIONS: Array<{ value: 'light' | 'dark' | 'system'; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="host-chrome__theme-toggle" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={preference === opt.value}
          data-active={preference === opt.value}
          onClick={() => setPreference(opt.value)}
        >
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
