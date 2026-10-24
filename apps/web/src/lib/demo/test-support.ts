import type { AppearanceCatalog, CatalogAxis } from '../studio/appearance';
import type { DemoUnit } from './browser-backend';
import type { StorageLike } from './storage';
import type { DemoSelection, SchemeModes } from './url-state';

// Test inputs for lib/demo's tests and Demo Studio's: a small catalog, the
// sample's own selection, a unit, and a Web Storage stand-in that can throw.

const option = (id: string, name: string) => ({
  id,
  name,
  description: null,
  tier: null,
  provenance: [],
  performance: null,
  access: null,
});

const axis = (
  id: CatalogAxis,
  label: string,
  fallback: string,
  options: readonly (readonly [string, string])[],
) => ({ axis: id, label, fallback, options: options.map(([value, name]) => option(value, name)) });

export const CATALOG: AppearanceCatalog = {
  axes: [
    axis('variant', 'Composition', 'fallback', [
      ['kinetic-cosmos', 'Kinetic Cosmos'],
      ['obsidian-atelier', 'Obsidian Atelier'],
    ]),
    axis('designLanguage', 'Design language', 'platform-neutral', [
      ['platform-neutral', 'Platform Neutral'],
    ]),
    axis('colorScheme', 'Color scheme', 'warm-parchment', [
      ['warm-parchment', 'Warm Parchment'],
      ['night-only', 'Night Only'],
    ]),
    axis('typography', 'Typography', 'humanist-ui', [['humanist-ui', 'Humanist UI']]),
    axis('displayMode', 'Display mode', 'system', [
      ['system', 'System'],
      ['light', 'Light'],
      ['dark', 'Dark'],
      ['high-contrast', 'High contrast'],
    ]),
  ],
};

export const SCHEME_MODES: SchemeModes = {
  'warm-parchment': ['light', 'dark'],
  'night-only': ['dark'],
};

/** The sample's own selection: its composition is one this build doesn't register. */
export const DEFAULTS: DemoSelection = {
  variant: 'editorial-evidence',
  designLanguage: 'platform-neutral',
  colorScheme: 'warm-parchment',
  typography: 'humanist-ui',
  displayMode: 'system',
};

export const UNIT: DemoUnit = {
  revisionId: 'sample-0123456789abcdef',
  documents: {
    portfolio: { format: 'yaml', sourceText: 'schemaVersion: 3\n', diagnostics: [], model: {} },
    site: {
      format: 'yaml',
      sourceText: 'schemaVersion: 2\n',
      diagnostics: [],
      model: { schemaVersion: 2, appearance: { ...DEFAULTS }, motionPolicy: 'respect-os' },
    },
  },
};

/** A Web Storage stand-in, which throws on writes once `full` is set, and on everything once `broken` is. */
export class FakeStorage implements StorageLike {
  readonly items = new Map<string, string>();
  full = false;
  broken = false;
  get length() {
    if (this.broken) throw new Error('SecurityError');
    return this.items.size;
  }
  key(index: number) {
    if (this.broken) throw new Error('SecurityError');
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    if (this.broken) throw new Error('SecurityError');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.broken) throw new Error('SecurityError');
    if (this.full) throw new Error('QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string) {
    if (this.broken) throw new Error('SecurityError');
    this.items.delete(key);
  }
}
