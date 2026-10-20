import { DEFAULT_SCHEMAS } from '../compose';
import { allowedKeysAt } from '../hints';
import { isPlainObject } from '../json';
import { PORTFOLIO_DEFAULTS, SITE_DEFAULTS } from '../legacy';
import { SCHEMA_VERSION } from '../portfolio';
import { redactedPointer } from '../secrets';
import { toPointer, type Locate } from '../source';
import { assignSectionIds, type AssignedId } from './section-ids';
import type { Change, NeedReason, UnknownKey } from './types';

// The one step so far: the unversioned one-file format (version 1) to the
// version 2 pair, per the mapping in #4, item 20. Keep it, and its
// fixtures, until #18 (homelab migration) closes.

type Path = readonly (string | number)[];

/** The old format's top-level keys, and its `meta` keys. */
const OLD_TOP = new Set([
  'identity',
  'variant',
  'theme',
  'motionPreference',
  'colorScheme',
  'typography',
  'links',
  'sections',
  'meta',
]);
const OLD_META = new Set(['title', 'description', 'url', 'ogImage']);

/**
 * The keys the old schema read at `path`, or undefined where it doesn't say.
 * Version 2 kept every old key below the top level, apart from section
 * `hidden`, and added `extensions` everywhere, section `lang`, and the stats
 * items' `metric`; the old schema dropped those when it read a file.
 */
function oldKeysAt(legacy: Record<string, unknown>, path: Path): ReadonlySet<string> | undefined {
  if (path.length === 0) return OLD_TOP;
  if (path.length === 1 && path[0] === 'meta') return OLD_META;
  const allowed = allowedKeysAt(DEFAULT_SCHEMAS.PortfolioSchema, legacy, path);
  if (!allowed) return undefined;
  const keys = new Set(allowed.filter((key) => key !== 'extensions'));
  if (path.length === 2 && path[0] === 'sections') {
    keys.delete('lang');
    keys.add('hidden');
  }
  const [top, index, field] = path;
  if (path.length === 4 && top === 'sections' && field === 'items') {
    const sections = legacy.sections;
    const section = Array.isArray(sections) ? sections[Number(index)] : undefined;
    if (isPlainObject(section) && section.kind === 'stats') keys.delete('metric');
  }
  return keys;
}

/** Every key the old schema would have dropped, in document order. */
function droppedByOldSchema(legacy: Record<string, unknown>): Path[] {
  const found: Path[] = [];
  const walk = (node: unknown, path: Path): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...path, index]));
      return;
    }
    if (!isPlainObject(node)) return;
    const keys = oldKeysAt(legacy, path);
    for (const [key, child] of Object.entries(node)) {
      if (keys && !keys.has(key)) found.push([...path, key]);
      else walk(child, [...path, key]);
    }
  };
  walk(legacy, []);
  return found;
}

function deleteAt(root: unknown, path: Path): void {
  let node = root;
  for (const segment of path.slice(0, -1)) {
    node = isPlainObject(node) || Array.isArray(node) ? (node as never)[segment] : undefined;
  }
  if (isPlainObject(node)) delete node[String(path.at(-1))];
}

/** The origin of an absolute http(s) URL, or undefined. */
function originOf(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

export interface LegacyStepResult {
  readonly portfolio: Record<string, unknown>;
  readonly site: Record<string, unknown>;
  readonly changes: Change[];
  readonly unknown: UnknownKey[];
  /** Why each value the owner has to give isn't filled in, by `--set` path. */
  readonly reasons: Map<string, NeedReason>;
  readonly ids: readonly AssignedId[];
  readonly origin?: string;
}

const DISPLAY_MODES = new Set(['system', 'light', 'dark']);
const MOTION_POLICIES = new Set(['respect-os', 'reduce']);

export function legacyStep(
  legacy: Record<string, unknown>,
  { locate, presetIds }: { locate: Locate; presetIds: ReadonlyMap<number, string> },
): LegacyStepResult {
  const changes: Change[] = [];
  const reasons = new Map<string, NeedReason>();
  const dropped = droppedByOldSchema(legacy);
  // A key could be a pasted secret, so no pointer repeats one.
  const unknown = dropped.map((path): UnknownKey => ({
    pointer: redactedPointer(path),
    ...locate(path, 'key'),
  }));
  const data = structuredClone(legacy);
  for (const path of dropped) deleteAt(data, path);

  const added = (document: 'portfolio' | 'site', pointer: string, value: string, note: string) =>
    changes.push({ code: 'default', to: { document, pointer }, value, note });
  const moved = (from: string, document: 'portfolio' | 'site', pointer: string, note?: string) =>
    changes.push({
      code: note ? 'mapped' : 'moved',
      from,
      to: { document, pointer },
      note: note ?? '',
    });

  // The portfolio: content keeps its pointers.
  const portfolio: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    locale: PORTFOLIO_DEFAULTS.locale,
    direction: PORTFOLIO_DEFAULTS.direction,
  };
  added('portfolio', '/locale', PORTFOLIO_DEFAULTS.locale, 'Pages were always marked en.');
  added(
    'portfolio',
    '/direction',
    PORTFOLIO_DEFAULTS.direction,
    'Pages were always left to right.',
  );
  for (const key of ['identity', 'links'] as const) if (key in data) portfolio[key] = data[key];

  let origin: string | undefined;
  if (isPlainObject(data.meta)) {
    const { url, ...meta } = data.meta;
    if ('url' in data.meta) {
      origin = originOf(url);
      changes.push({
        code: 'removed',
        from: '/meta/url',
        ...(origin ? { value: origin } : {}),
        note: 'The canonical origin is a deployment setting now: PORTFOLIO_ORIGIN.',
      });
    }
    if (Object.keys(meta).length > 0) portfolio.meta = meta;
  } else if ('meta' in data) {
    portfolio.meta = data.meta;
  }

  const hidden: Record<string, { hidden: true }> = {};
  let ids: AssignedId[] = [];
  if (Array.isArray(data.sections)) {
    ids = assignSectionIds(data.sections, presetIds);
    portfolio.sections = data.sections.map((section, index) => {
      const { id } = ids[index]!;
      if (!isPlainObject(section)) return section;
      const { hidden: flag, ...rest } = section;
      if (flag === true) {
        hidden[id] = { hidden: true };
        moved(`/sections/${index}/hidden`, 'site', toPointer(['sections', id, 'hidden']));
      } else if ('hidden' in section) {
        changes.push({
          code: 'removed',
          from: `/sections/${index}/hidden`,
          note: 'Only hidden: true hides a section, so this one stays visible.',
        });
      }
      return { ...rest, id };
    });
  } else if ('sections' in data) {
    portfolio.sections = data.sections;
  }

  // The site document: appearance, motion, and features.
  const appearance: Record<string, unknown> = {};
  if (data.variant === undefined) {
    appearance.variant = SITE_DEFAULTS.variant;
    added('site', '/appearance/variant', SITE_DEFAULTS.variant, "The old format's default.");
  } else if (typeof data.variant === 'string') {
    appearance.variant = data.variant;
    moved('/variant', 'site', '/appearance/variant');
  } else {
    reasons.set('site.appearance.variant', { reason: "The old variant isn't an id." });
  }
  appearance.designLanguage = SITE_DEFAULTS.designLanguage;
  added(
    'site',
    '/appearance/designLanguage',
    SITE_DEFAULTS.designLanguage,
    'The old format had no design language.',
  );
  for (const axis of ['colorScheme', 'typography'] as const) {
    const old = data[axis];
    reasons.set(`site.appearance.${axis}`, {
      reason:
        old === undefined
          ? 'The old format had none, and this release needs one.'
          : "The old id doesn't carry over: this release's ids are new.",
      ...(typeof old === 'string' ? { was: old } : {}),
    });
  }
  const theme = data.theme;
  if (theme === undefined) {
    appearance.displayMode = SITE_DEFAULTS.displayMode;
    added(
      'site',
      '/appearance/displayMode',
      SITE_DEFAULTS.displayMode,
      "The old format's default.",
    );
  } else if (typeof theme === 'string' && DISPLAY_MODES.has(theme)) {
    appearance.displayMode = theme;
    moved('/theme', 'site', '/appearance/displayMode');
  } else {
    reasons.set('site.appearance.displayMode', {
      reason:
        theme === 'bright' || theme === 'black'
          ? 'The old theme has no display mode now.'
          : "The old theme isn't a display mode.",
      ...(typeof theme === 'string' ? { was: theme } : {}),
    });
  }

  const site: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    appearance,
    visitorControls: { ...SITE_DEFAULTS.visitorControls },
  };
  changes.push({
    code: 'default',
    to: { document: 'site', pointer: '/visitorControls' },
    note: 'Visitors may pick the color scheme and the display mode; the rest is locked.',
  });

  const motion = data.motionPreference;
  if (motion === undefined) {
    site.motionPolicy = SITE_DEFAULTS.motionPolicy;
    added('site', '/motionPolicy', SITE_DEFAULTS.motionPolicy, "The old format's default.");
  } else if (typeof motion === 'string' && MOTION_POLICIES.has(motion)) {
    site.motionPolicy = motion;
    moved('/motionPreference', 'site', '/motionPolicy');
  } else if (motion === 'full') {
    site.motionPolicy = 'respect-os';
    moved(
      '/motionPreference',
      'site',
      '/motionPolicy',
      "full becomes respect-os: nothing forces motion past the visitor's OS setting now.",
    );
  } else {
    reasons.set('site.motionPolicy', {
      reason: "The old motion preference isn't a motion policy.",
    });
  }

  site.features = { feed: true };
  added('site', '/features/feed', 'true', 'The feed was always on.');
  if (Object.keys(hidden).length > 0) site.sections = hidden;

  return {
    portfolio,
    site,
    changes,
    unknown,
    reasons,
    ids,
    ...(origin ? { origin } : {}),
  };
}
