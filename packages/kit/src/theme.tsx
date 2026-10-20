'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { isThemePreference, THEME_STORAGE_KEY, type ThemePreference } from './theme-init';

export type { ThemePreference } from './theme-init';

export type ResolvedTheme = 'light' | 'dark' | 'bright' | 'black';

/**
 * Resolve a theme preference into a concrete `data-theme` value the variant
 * supports. `system` reads `prefers-color-scheme` (passed in for testability).
 * `bright` falls back to `light` and `black` falls back to `dark` when the
 * variant doesn't list them in its themes manifest.
 */
export function resolveTheme(
  preference: ThemePreference,
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

function readStoredPreference(): ThemePreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(raw)) return raw;
  } catch {
    // ignore
  }
  return null;
}

// Only setPreference writes the stored value, and it re-renders through its
// own state, so there is nothing to subscribe to.
function subscribeToNothing(): () => void {
  return () => {};
}

function serverStoredPreference(): ThemePreference | null {
  return null;
}

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function subscribeSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia(DARK_SCHEME_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
}

function serverSystemTheme(): 'light' | 'dark' {
  return 'light';
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
  // The server and hydration see neither storage nor the OS scheme; the stored
  // and system values take over right after hydration.
  const [chosen, setChosen] = useState<ThemePreference | null>(null);
  const stored = useSyncExternalStore(
    subscribeToNothing,
    readStoredPreference,
    serverStoredPreference,
  );
  const system = useSyncExternalStore(subscribeSystemTheme, systemTheme, serverSystemTheme);
  const preference = chosen ?? stored ?? defaultPreference;
  const resolved = resolveTheme(preference, supportedThemes, () => system);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setChosen(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
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
