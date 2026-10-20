import { isPlainObject } from './json';
import { toPointer } from './pointer';

// The unversioned one-file format, which counts as version 1 (#4, item 18).
// This release refuses it with one legacy.document diagnostic, and only
// `pnpm config:migrate` (`@portfolio/schema/migrate`) converts it. Keep this
// and the migration's legacy step until #18 (homelab migration) closes.

/** What a document is, by its top-level keys. */
export type DocumentType = 'portfolio' | 'site' | 'legacy' | 'unknown';

/** Top-level keys that mark the old format in a document without `schemaVersion`. */
export const LEGACY_MARKERS: readonly string[] = [
  'identity',
  'sections',
  'variant',
  'theme',
  'motionPreference',
  'colorScheme',
  'typography',
];

/**
 * With `schemaVersion`, `identity` makes a portfolio and `appearance` a site
 * document, and either both or neither is unknown. Without it, any old marker
 * makes the old format.
 */
export function detectDocument(raw: unknown): DocumentType {
  if (!isPlainObject(raw)) return 'unknown';
  if ('schemaVersion' in raw) {
    const portfolio = 'identity' in raw;
    const site = 'appearance' in raw;
    if (portfolio === site) return 'unknown';
    return portfolio ? 'portfolio' : 'site';
  }
  return LEGACY_MARKERS.some((key) => key in raw) ? 'legacy' : 'unknown';
}

/** What the migration writes where the old file has nothing (#4, item 20). */
export const PORTFOLIO_DEFAULTS = Object.freeze({ locale: 'en', direction: 'ltr' } as const);
export const SITE_DEFAULTS = Object.freeze({
  variant: 'editorial',
  designLanguage: 'platform-neutral',
  displayMode: 'system',
  visitorControls: Object.freeze({
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'selectable',
    typography: 'locked',
    displayMode: 'selectable',
  } as const),
  motionPolicy: 'respect-os',
  features: Object.freeze({ feed: true } as const),
} as const);

/** The command that converts an old file, as messages print it. */
export const MIGRATE_COMMAND = 'pnpm config:migrate';

/** A site document to start from, with the ids left for the owner to pick. */
export const SITE_SKELETON = [
  'schemaVersion: 2',
  'appearance:',
  `  variant: ${SITE_DEFAULTS.variant}`,
  `  designLanguage: ${SITE_DEFAULTS.designLanguage}`,
  '  colorScheme: <a color scheme id this release registers>',
  '  typography: <a typography preset id this release registers>',
  `  displayMode: ${SITE_DEFAULTS.displayMode}`,
  'visitorControls:',
  ...Object.entries(SITE_DEFAULTS.visitorControls).map(
    ([axis, control]) => `  ${axis}: ${control}`,
  ),
  `motionPolicy: ${SITE_DEFAULTS.motionPolicy}`,
  'features:',
  '  feed: true',
  '',
].join('\n');

/** An old field in a legacy document, and where its value goes now. */
export interface LegacyField {
  readonly path: readonly (string | number)[];
  readonly home: string;
}

const HOMES: Readonly<Record<string, string>> = {
  variant: 'appearance.variant in site.yml',
  theme: 'appearance.displayMode in site.yml',
  motionPreference: 'motionPolicy in site.yml',
  colorScheme: 'appearance.colorScheme in site.yml, as an id this release registers',
  typography: 'appearance.typography in site.yml, as an id this release registers',
};

/** Every old field the document holds, in document order. */
export function legacyFields(data: unknown): LegacyField[] {
  if (!isPlainObject(data)) return [];
  const fields: LegacyField[] = [];
  for (const [key, value] of Object.entries(data)) {
    const home = HOMES[key];
    if (home) {
      fields.push({ path: [key], home });
    } else if (key === 'meta' && isPlainObject(value) && 'url' in value) {
      fields.push({ path: ['meta', 'url'], home: 'the PORTFOLIO_ORIGIN setting' });
    } else if (key === 'sections' && Array.isArray(value)) {
      value.forEach((section, index) => {
        if (isPlainObject(section) && 'hidden' in section) {
          fields.push({
            path: ['sections', index, 'hidden'],
            home: 'sections.<id>.hidden in site.yml',
          });
        }
      });
    }
  }
  return fields;
}

/**
 * The legacy.document message: each old field the document holds with its
 * new home, and the command that converts the file. It names fields, never
 * their values.
 */
export function legacyMessage(data: unknown, file?: string): string {
  const moves = legacyFields(data).map(({ path, home }) => `${toPointer(path)} to ${home}`);
  const fields =
    moves.length === 0
      ? ''
      : ` Its old fields move: ${moves.length === 1 ? moves[0] : `${moves.slice(0, -1).join(', ')}, and ${moves.at(-1)}`}.`;
  return `${file ?? 'The document'} is in the old one-file format, which this release doesn't read.${fields} Run ${MIGRATE_COMMAND} ${file ?? 'on it'} to split it into portfolio.yml and site.yml.`;
}
