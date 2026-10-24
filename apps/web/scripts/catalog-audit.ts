// The branded-name audit (#20): every shipping pack and Research record,
// read for the brands, systems, palettes, and typefaces it names, and held
// to how it may name them. `pnpm check:appearance` fails on any finding,
// and `pnpm catalog audit` prints the whole table.
//
// A pack may name a brand in its id or display name only as an `-inspired`
// interpretation (independent-inspired-interpretation, which #117's
// governance already holds to an -inspired id and an Inspired name) or as
// an adaptation under the brand's own upstream license, whose provenance
// names it. A description that names a brand credits it in the provenance.
// A scheme never carries a Research record's palette under another name:
// its anchors can't share two colors in one mode with a record's. A
// typography profile's name never names a typeface its stacks reference,
// so it can't read as that font's own. A reviewed exception says why a
// name that matches is fine, and an exception nothing matches is a finding
// too, so the list can't go stale.

import { readFileSync } from 'node:fs';
import {
  AXIS_BY_KIND,
  AXIS_NAMES,
  isUpstreamLicense,
  type ColorSchemeManifest,
  type PackAxis,
  type PackKind,
  type PackManifest,
  type ResearchRecord,
  type TypographyManifest,
} from '@portfolio/appearance';

/** A brand, system, palette, or typeface a pack might name, and whose it is. */
export interface BrandedTerm {
  readonly term: string;
  readonly owner: string;
}

/**
 * The names the audit reads for, beside every Research record's own name.
 * Brands and design systems, then typefaces. Each is matched as a whole
 * word, case-sensitively in prose and as a slug in an id.
 */
export const BRANDED_TERMS: readonly BrandedTerm[] = [
  { term: 'Apple', owner: 'Apple' },
  { term: 'Aqua', owner: 'Apple' },
  { term: 'macOS', owner: 'Apple' },
  { term: 'iOS', owner: 'Apple' },
  { term: 'visionOS', owner: 'Apple' },
  { term: 'Liquid Glass', owner: 'Apple' },
  { term: 'Human Interface', owner: 'Apple' },
  { term: 'Cupertino', owner: 'Apple' },
  { term: 'Material', owner: 'Google' },
  { term: 'Google', owner: 'Google' },
  { term: 'Fluent', owner: 'Microsoft' },
  { term: 'Microsoft', owner: 'Microsoft' },
  { term: 'Windows', owner: 'Microsoft' },
  { term: 'Metro', owner: 'Microsoft' },
  { term: 'Aero', owner: 'Microsoft' },
  { term: 'Carbon', owner: 'IBM' },
  { term: 'IBM', owner: 'IBM' },
  { term: 'Primer', owner: 'GitHub' },
  { term: 'GitHub', owner: 'GitHub' },
  { term: 'Atlassian', owner: 'Atlassian' },
  { term: 'Polaris', owner: 'Shopify' },
  { term: 'Shopify', owner: 'Shopify' },
  { term: 'Ant Design', owner: 'Ant Group' },
  { term: 'Bootstrap', owner: 'the Bootstrap project' },
  { term: 'Tailwind', owner: 'Tailwind Labs' },
  { term: 'Radix', owner: 'WorkOS' },
  { term: 'Chakra', owner: 'the Chakra UI project' },
  { term: 'Salesforce', owner: 'Salesforce' },
  { term: 'Lightning', owner: 'Salesforce' },
  { term: 'Spectrum', owner: 'Adobe' },
  { term: 'Adobe', owner: 'Adobe' },
  { term: 'Fiori', owner: 'SAP' },
  { term: 'Geist', owner: 'Vercel' },
  { term: 'Vercel', owner: 'Vercel' },
  { term: 'Blueprint', owner: 'Palantir, the Blueprint toolkit' },
  { term: 'Frutiger', owner: 'Linotype, the Frutiger typeface' },
  { term: 'Helvetica', owner: 'Linotype, the Helvetica typeface' },
  { term: 'Futura', owner: 'the Futura typeface' },
  { term: 'Avenir', owner: 'Linotype, the Avenir typeface' },
  { term: 'Segoe', owner: 'Microsoft, the Segoe typeface' },
  { term: 'San Francisco', owner: 'Apple, the San Francisco typeface' },
  { term: 'Roboto', owner: 'Google, the Roboto typeface' },
  { term: 'Verdana', owner: 'Microsoft, the Verdana typeface' },
  { term: 'Tahoma', owner: 'Microsoft, the Tahoma typeface' },
  { term: 'Charter', owner: 'the Charter typeface' },
  { term: 'Iowan', owner: 'the Iowan Old Style typeface' },
  { term: 'Palatino', owner: 'Linotype, the Palatino typeface' },
  { term: 'Trebuchet', owner: 'Microsoft, the Trebuchet typeface' },
  { term: 'Consolas', owner: 'Microsoft, the Consolas typeface' },
  { term: 'Inter', owner: 'the Inter typeface' },
];

/**
 * Names the audit matches that a reviewer cleared, by pack id and term,
 * with why. Each must still match something, or it's a finding.
 */
export const REVIEWED_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'frutiger-aero': {
    Frutiger:
      'it names the 2000s Frutiger Aero aesthetic, not the typeface, and it references no Frutiger font (the typeface-reference rule holds it to that).',
    Aero: 'it names the same aesthetic, not Windows Aero, and ships no Microsoft asset.',
  },
  blueprint: {
    Blueprint:
      "it names the technical-drawing style, not Palantir's toolkit, and takes none of its components or tokens.",
  },
};

/** How a catalog entry stands toward what it names. */
export type AuditStatus =
  | 'first-party'
  | 'upstream'
  | 'inspired'
  | 'provided-by-operating-system'
  | 'generated'
  | 'research';

export interface AuditEntry {
  readonly id: string;
  readonly axis: PackAxis;
  /** The pack's tier, or research. */
  readonly tier: string;
  readonly status: AuditStatus;
  readonly license: string;
  /** The branded terms it names, in its id, name, or description. */
  readonly names: readonly string[];
  /** The typefaces its stacks reference, for a typography profile: provided by the OS, never shipped. */
  readonly references: readonly string[];
  /** Why each name is fine: inspired, upstream, credited, or reviewed. */
  readonly notes: readonly string[];
}

export interface AuditFinding {
  readonly pack: string;
  readonly axis: PackAxis;
  readonly rule:
    | 'branded-name'
    | 'uncredited-name'
    | 'research-palette'
    | 'upstream-palette'
    | 'typeface-name'
    | 'typeface-reference'
    | 'stale-review';
  readonly message: string;
}

export interface AuditInput {
  /** Every shipping pack, as registry generation read it. */
  readonly packs: readonly {
    readonly kind: PackKind;
    readonly manifest: PackManifest;
    /** Its stylesheet's text, for a language that has one. */
    readonly stylesheet?: string;
  }[];
  /** Every Research record. */
  readonly research: readonly ResearchRecord[];
  /** The reviewed exceptions; REVIEWED_NAMES by default. */
  readonly reviewed?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The upstream palettes a scheme is read against; UPSTREAM_PALETTES by default. */
  readonly palettes?: readonly UpstreamPalette[];
}

/** An upstream palette whose values a scheme could carry, such as Tailwind CSS v3's scales. */
export interface UpstreamPalette {
  readonly id: string;
  /** Its name, which a crediting scheme's provenance names. */
  readonly name: string;
  readonly version: string;
  readonly url: string;
  readonly license: string;
  readonly copyright: string;
  /** Each color by its upstream name, such as zinc-950. */
  readonly colors: Readonly<Record<string, string>>;
}

/**
 * The upstream palettes the audit knows, from upstream-palettes.json:
 * Tailwind CSS v3.4.17's scales, read from its src/public/colors.js.
 */
export const UPSTREAM_PALETTES: readonly UpstreamPalette[] = (
  JSON.parse(readFileSync(new URL('./upstream-palettes.json', import.meta.url), 'utf8')) as {
    palettes: UpstreamPalette[];
  }
).palettes;

/** The two-anchor threshold: a mode that shares this many anchors with a palette carries it. */
export const SHARED_ANCHORS = 2;

export interface AuditReport {
  readonly entries: readonly AuditEntry[];
  readonly findings: readonly AuditFinding[];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Whether `term` is a whole word of `text`, as written. */
function inProse(text: string, term: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

/** Whether `term`'s slug is a whole segment run of `id`. */
function inId(id: string, term: string): boolean {
  return `-${id}-`.includes(`-${slug(term)}-`);
}

function statusOf(license: string): AuditStatus {
  if (license === 'independent-inspired-interpretation') return 'inspired';
  if (license === 'provided-by-operating-system') return 'provided-by-operating-system';
  if (license === 'generated') return 'generated';
  if (isUpstreamLicense(license)) return 'upstream';
  return 'first-party';
}

/** The base modes schemeAnchors() reads, in its order. */
function modeNames(manifest: ColorSchemeManifest): string[] {
  return (['light', 'dark'] as const).filter((mode) => manifest.anchors?.[mode] || manifest[mode]);
}

/** A scheme's anchor colors per base mode: its anchors, or its authored sets' anchor roles. */
function schemeAnchors(manifest: ColorSchemeManifest): string[][] {
  const modes: string[][] = [];
  for (const mode of ['light', 'dark'] as const) {
    const anchors = manifest.anchors?.[mode];
    const set = manifest[mode];
    if (anchors) modes.push([anchors.canvas, anchors.text, anchors.accent, anchors.secondary]);
    else if (set)
      modes.push([set.canvas, set['text-primary'], set.accent, set.information].filter(Boolean));
  }
  return modes;
}

function researchAnchors(record: ResearchRecord): string[] {
  return (['light', 'dark'] as const).flatMap((mode) => {
    const anchors = record.anchors?.[mode];
    return anchors ? [anchors.canvas, anchors.text, anchors.accent, anchors.secondary] : [];
  });
}

/** The named families in a font stack, less the generic ones and platform keywords. */
function families(stack: string): string[] {
  return stack
    .split(',')
    .map((family) => family.trim().replace(/^"|"$/g, ''))
    .filter(
      (family) =>
        !/^-|^(?:system-ui|sans-serif|serif|monospace|cursive|fantasy|ui-[a-z-]+|BlinkMacSystemFont|emoji|math|fangsong)$/.test(
          family,
        ),
    );
}

/** The audit over every shipping pack and Research record. */
export function auditCatalog(input: AuditInput): AuditReport {
  const reviewed = input.reviewed ?? REVIEWED_NAMES;
  const palettes = input.palettes ?? UPSTREAM_PALETTES;
  const terms: BrandedTerm[] = [
    ...BRANDED_TERMS,
    ...input.research.map((record) => ({
      term: record.name,
      owner: `${record.source.name}, a Research record`,
    })),
  ];
  const used = new Set<string>();
  const entries: AuditEntry[] = [];
  const findings: AuditFinding[] = [];

  for (const { kind, manifest, stylesheet } of input.packs) {
    const axis = AXIS_BY_KIND[kind];
    const subject = `The ${AXIS_NAMES[axis]} ${manifest.id}`;
    const { license, source, attribution } = manifest.provenance;
    const status = statusOf(license);
    const credit = `${source.name} ${attribution}`;
    const names: string[] = [];
    const notes: string[] = [];
    const cleared = (term: string) => {
      const why = reviewed[manifest.id]?.[term];
      if (why) used.add(`${manifest.id}\0${term}`);
      return why;
    };

    for (const { term, owner } of terms) {
      const named = inId(manifest.id, term) || inProse(manifest.name, term);
      const described = inProse(manifest.description, term);
      if (!named && !described) continue;
      names.push(term);
      const why = cleared(term);
      if (why) {
        notes.push(`${term}: reviewed, ${why}`);
        continue;
      }
      if (named) {
        if (status === 'inspired') notes.push(`${term}: an inspired interpretation of ${owner}.`);
        else if (status === 'upstream' && inProse(credit, term))
          notes.push(`${term}: adapted under ${license}, credited to ${source.name}.`);
        else
          findings.push({
            pack: manifest.id,
            axis,
            rule: 'branded-name',
            message: `${subject} names ${term} (${owner}) in its id or name, as neither an -inspired interpretation nor an adaptation under its upstream license.`,
          });
      }
      if (described) {
        if (inProse(credit, term) || status === 'inspired')
          notes.push(`${term}: named in its description and credited in its provenance.`);
        else
          findings.push({
            pack: manifest.id,
            axis,
            rule: 'uncredited-name',
            message: `${subject} names ${term} (${owner}) in its description, and its provenance doesn't credit it.`,
          });
      }
    }

    if (kind === 'color-scheme') {
      // Against the upstream palettes: two shared anchors in a mode is carrying
      // the palette, which only an adaptation under its license, crediting it, may.
      const modes = schemeAnchors(manifest as ColorSchemeManifest);
      for (const palette of palettes) {
        const named = new Map<string, string>();
        for (const [name, hex] of Object.entries(palette.colors)) {
          if (!named.has(hex)) named.set(hex, name);
        }
        const word = palette.name.split(' ')[0]!;
        modes.forEach((mode, index) => {
          const shared = [...new Set(mode.filter((color) => named.has(color)))];
          if (shared.length === 0) return;
          const which = shared.map((hex) => `${named.get(hex)} ${hex}`).join(', ');
          const where = `${modeNames(manifest as ColorSchemeManifest)[index]} mode`;
          if (shared.length < SHARED_ANCHORS) {
            notes.push(
              `${palette.name}: shares one anchor in its ${where} (${which}), under the ${SHARED_ANCHORS}-anchor threshold.`,
            );
          } else if (
            status === 'upstream' &&
            license === palette.license &&
            inProse(credit, word) &&
            manifest.provenance.copyright === palette.copyright
          ) {
            notes.push(
              `${palette.name}: carries ${which} in its ${where}, credited under ${license}.`,
            );
          } else {
            findings.push({
              pack: manifest.id,
              axis,
              rule: 'upstream-palette',
              message: `${subject} carries ${palette.name} ${palette.version} in its ${where} (${which}), and its provenance doesn't credit it under ${palette.license} with "${palette.copyright}".`,
            });
          }
        });
      }
      for (const mode of schemeAnchors(manifest as ColorSchemeManifest)) {
        for (const record of input.research) {
          const shared = new Set(mode.filter((color) => researchAnchors(record).includes(color)));
          if (shared.size >= 2) {
            findings.push({
              pack: manifest.id,
              axis,
              rule: 'research-palette',
              message: `${subject} shares ${[...shared].join(', ')} with the Research record ${record.id}, whose license isn't verified: a shipping scheme can't carry its palette.`,
            });
          }
        }
      }
    }

    // A language names no typeface in what it ships: its tokens, and its stylesheet when it has one.
    if (kind === 'design-language') {
      const shipped =
        `${JSON.stringify((manifest as { tokens?: unknown }).tokens ?? {})} ${stylesheet ?? ''}`
          .split(manifest.id)
          .join(' ');
      for (const { term, owner } of BRANDED_TERMS.filter(({ owner }) =>
        owner.includes('typeface'),
      )) {
        if (
          new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}($|[^\\p{L}\\p{N}])`, 'iu').test(shipped)
        ) {
          findings.push({
            pack: manifest.id,
            axis,
            rule: 'typeface-reference',
            message: `${subject} references ${term} (${owner}) in what it ships: a design language takes no font.`,
          });
        }
      }
    }

    const references: string[] = [];
    if (kind === 'typography') {
      const profile = manifest as TypographyManifest;
      for (const role of Object.values(profile.roles)) {
        for (const family of families(role['font-family'])) {
          if (!references.includes(family)) references.push(family);
        }
      }
      for (const family of references) {
        const word = family.split(' ')[0]!;
        if (inId(manifest.id, word) || inProse(manifest.name, word)) {
          if (cleared(word)) continue;
          findings.push({
            pack: manifest.id,
            axis,
            rule: 'typeface-name',
            message: `${subject} is named for ${family}, a typeface its stacks reference: a profile that ships no font file can't read as that font's own.`,
          });
        }
      }
    }

    entries.push({
      id: manifest.id,
      axis,
      tier: manifest.tier,
      status,
      license,
      names,
      references,
      notes,
    });
  }

  for (const record of input.research) {
    entries.push({
      id: record.id,
      axis: AXIS_BY_KIND[record.kind],
      tier: 'research',
      status: 'research',
      license: record.license,
      names: [record.name],
      references: [],
      notes: [`${record.name}: a Research record, never registered or shipped.`],
    });
  }

  for (const [id, terms] of Object.entries(reviewed)) {
    for (const term of Object.keys(terms)) {
      if (used.has(`${id}\0${term}`)) continue;
      const pack = input.packs.find(({ manifest }) => manifest.id === id);
      findings.push({
        pack: id,
        axis: pack ? AXIS_BY_KIND[pack.kind] : 'designLanguage',
        rule: 'stale-review',
        message: `The reviewed name ${term} for ${id} matches nothing: remove it from REVIEWED_NAMES in apps/web/scripts/catalog-audit.ts.`,
      });
    }
  }

  entries.sort((a, b) =>
    a.axis !== b.axis ? (a.axis < b.axis ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return { entries, findings };
}
