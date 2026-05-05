'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ThemePreference } from '@portfolio/schema';

export type ResolvedTheme = 'light' | 'dark' | 'bright' | 'black';

/**
 * Resolve a theme preference into a concrete `data-theme` value the variant
 * supports. `system` reads `prefers-color-scheme` (passed in for testability).
 * `bright` falls back to `light` and `black` falls back to `dark` when the
 * variant doesn't list them in its themes manifest.
 */
export function resolveTheme(
  preference: 'light' | 'dark' | 'bright' | 'black' | 'system',
  supported: readonly string[],
  systemMatch: () => 'light' | 'dark',
): ResolvedTheme {
  if (preference === 'system') return systemMatch();
  if (preference === 'light' || preference === 'dark') return preference;
  if (preference === 'bright') return supported.includes('bright') ? 'bright' : 'light';
  if (preference === 'black') return supported.includes('black') ? 'black' : 'dark';
  return 'light';
}

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'portfolio:theme';

function readStoredPreference(): ThemePreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (
      raw === 'light' ||
      raw === 'dark' ||
      raw === 'bright' ||
      raw === 'black' ||
      raw === 'system'
    ) return raw;
  } catch {
    // ignore
  }
  return null;
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolved;
  const colorSchemeValue =
    resolved === 'bright' ? 'light' : resolved === 'black' ? 'dark' : resolved;
  document.documentElement.style.colorScheme = colorSchemeValue;
}

interface ThemeProviderProps {
  children: ReactNode;
  defaultPreference?: ThemePreference;
  supportedThemes?: readonly string[];
}

export function ThemeProvider({
  children,
  defaultPreference = 'system',
  supportedThemes = ['light', 'dark'],
}: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(defaultPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

  useEffect(() => {
    const stored = readStoredPreference();
    if (stored) setPreferenceState(stored);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const compute = () => {
      const next = resolveTheme(preference, supportedThemes, () =>
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      );
      setResolved(next);
      applyTheme(next);
    };
    compute();
    if (preference === 'system') {
      mq.addEventListener('change', compute);
      return () => mq.removeEventListener('change', compute);
    }
    return undefined;
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

/**
 * Inline script that runs before React hydration to set the data-theme attr,
 * preventing a flash of wrong theme on first paint.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var pref = stored || 'system';
    var resolved;
    if (pref === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else if (pref === 'bright') {
      resolved = 'light';
    } else if (pref === 'black') {
      resolved = 'dark';
    } else {
      resolved = pref;
    }
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved === 'bright' ? 'light' : resolved === 'black' ? 'dark' : resolved;
  } catch (e) {}
})();
`.trim();
