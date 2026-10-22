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

/** The command that gives every entry without a well-formed id one, as messages print it. */
export const IDS_FIX_COMMAND = 'pnpm config:ids-fix';

const SKELETON_IDS = {
  colorScheme: '<a color scheme id this release registers>',
  typography: '<a typography preset id this release registers>',
};

/** A site document to start from, with the ids left for the owner to pick. */
export const SITE_SKELETON = [
  'schemaVersion: 2',
  'appearance:',
  `  variant: ${SITE_DEFAULTS.variant}`,
  `  designLanguage: ${SITE_DEFAULTS.designLanguage}`,
  `  colorScheme: ${SKELETON_IDS.colorScheme}`,
  `  typography: ${SKELETON_IDS.typography}`,
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

/** SITE_SKELETON as JSON, for an owner whose documents are JSON. */
export const SITE_SKELETON_JSON = `${JSON.stringify(
  {
    schemaVersion: 2,
    appearance: {
      variant: SITE_DEFAULTS.variant,
      designLanguage: SITE_DEFAULTS.designLanguage,
      ...SKELETON_IDS,
      displayMode: SITE_DEFAULTS.displayMode,
    },
    visitorControls: SITE_DEFAULTS.visitorControls,
    motionPolicy: SITE_DEFAULTS.motionPolicy,
    features: SITE_DEFAULTS.features,
  },
  null,
  2,
)}\n`;

/** The two documents a migration of `file` writes, YAML or JSON as it is. */
export function migratedNames(file?: string): {
  readonly portfolio: string;
  readonly site: string;
} {
  const extension = file !== undefined && /\.json$/i.test(file) ? 'json' : 'yml';
  return { portfolio: `portfolio.${extension}`, site: `site.${extension}` };
}

/**
 * An old field in a legacy document, and where its value goes now. Without
 * a `home`, it goes away: `hidden: false`, since a section shows unless the
 * site document hides it.
 */
export interface LegacyField {
  readonly path: readonly (string | number)[];
  readonly home?: string;
}

/** Each old top-level field's new home, given the site document's name. A Map, so `constructor` and the other Object.prototype names aren't in it. */
const HOMES: ReadonlyMap<string, (site: string) => string> = new Map([
  ['variant', (site: string) => `appearance.variant in ${site}`],
  ['theme', (site: string) => `appearance.displayMode in ${site}`],
  ['motionPreference', (site: string) => `motionPolicy in ${site}`],
  [
    'colorScheme',
    (site: string) => `appearance.colorScheme in ${site}, as an id this release registers`,
  ],
  [
    'typography',
    (site: string) => `appearance.typography in ${site}, as an id this release registers`,
  ],
]);

/** Every old field the document holds, in document order, for a site document named `site`. */
export function legacyFields(data: unknown, site = 'site.yml'): LegacyField[] {
  if (!isPlainObject(data)) return [];
  const fields: LegacyField[] = [];
  for (const [key, value] of Object.entries(data)) {
    const home = HOMES.get(key);
    if (home) {
      fields.push({ path: [key], home: home(site) });
    } else if (key === 'meta' && isPlainObject(value) && Object.hasOwn(value, 'url')) {
      fields.push({ path: ['meta', 'url'], home: 'the PORTFOLIO_ORIGIN setting' });
    } else if (key === 'sections' && Array.isArray(value)) {
      value.forEach((section, index) => {
        if (isPlainObject(section) && Object.hasOwn(section, 'hidden')) {
          fields.push({
            path: ['sections', index, 'hidden'],
            ...(section.hidden === true ? { home: `sections.<id>.hidden in ${site}` } : {}),
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
 * their values. `file` is the file as the reader would type it, so the
 * command it prints works where they are.
 */
export function legacyMessage(data: unknown, file?: string): string {
  const names = migratedNames(file);
  const fields = legacyFields(data, names.site);
  const moves = fields.flatMap(({ path, home }) => (home ? [`${toPointer(path)} to ${home}`] : []));
  const gone = fields.flatMap(({ path, home }) => (home ? [] : [toPointer(path)]));
  const moved = moves.length === 0 ? '' : ` Its old fields move: ${list(moves)}.`;
  const removed =
    gone.length === 0
      ? ''
      : ` ${list(gone)} ${gone.length === 1 ? 'goes' : 'go'}: a section shows unless ${names.site} hides it.`;
  const command = file === undefined ? 'on it' : shellQuote(file);
  return `${file ?? 'The document'} is in the old one-file format, which this release doesn't read.${moved}${removed} Run ${MIGRATE_COMMAND} ${command} to split it into ${names.portfolio} and ${names.site}.`;
}

/**
 * The `--set` paths a migration of the old document stops on: its color
 * scheme and typography always, since no old id carries over, and a variant,
 * theme, or motion preference with no counterpart. `variants` are the ids the
 * catalog registers, when there's one to ask.
 */
export function legacyNeeds(data: unknown, variants?: readonly string[] | null): string[] {
  if (!isPlainObject(data)) return [];
  const own = (key: string) => (Object.hasOwn(data, key) ? data[key] : undefined);
  const needs: string[] = [];
  const variant = own('variant') ?? SITE_DEFAULTS.variant;
  if (typeof variant !== 'string' || (variants && !variants.includes(variant))) {
    needs.push('site.appearance.variant');
  }
  needs.push('site.appearance.colorScheme', 'site.appearance.typography');
  const theme = own('theme');
  if (theme !== undefined && !['system', 'light', 'dark'].includes(theme as string)) {
    needs.push('site.appearance.displayMode');
  }
  const motion = own('motionPreference');
  if (motion !== undefined && !['respect-os', 'reduce', 'full'].includes(motion as string)) {
    needs.push('site.motionPolicy');
  }
  return needs;
}

/**
 * One word of a command for a POSIX shell: as it is when every character is
 * safe there, else in single quotes, each embedded quote written as '\''.
 */
export function shellQuote(word: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}
