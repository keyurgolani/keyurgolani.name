// The typography picker's stills (P-5, thumbnail-pipeline.md §3): what each
// self-hosted pack's row shows in place of its web font, so Studio's own
// document never loads one. Each still is a PNG shot from the pack's own
// vendored woff2 files by `pnpm stills:type`, an alpha mask on a
// transparent ground that Studio paints in its ink colour, and committed
// with a record of the files it was shot from (apps/web/studio-stills/type/).
// Registry generation serves each one at a content-hashed URL under
// /_portfolio/studio/, and `pnpm check:budgets` holds them to Studio's own
// image line in runtime-budgets.json: Studio assets, never a pack's, and
// never requested by a public page.
//
// A system-font pack has no still: a system face renders differently on
// every platform, so its row sets its name in its own stack and says
// "System font". Plain data and functions, so the client can read them.

/** Where the host serves Studio's own content-hashed assets. */
export const STUDIO_ASSET_URL = '/_portfolio/studio/';

/** The two stills a type row shows: the display "Aa", and a line in the body face. */
export const TYPE_STILL_ROLES = ['aa', 'line'] as const;
export type TypeStillRole = (typeof TYPE_STILL_ROLES)[number];

/** The text each still sets. */
export const TYPE_STILL_TEXT: Readonly<Record<TypeStillRole, string>> = Object.freeze({
  aa: 'Aa',
  line: 'I make failure legible.',
});

/**
 * The manifest role each still sets by default: the "Aa" in the display role, the line in
 * the body role.
 */
export const TYPE_STILL_DEFAULT_FACE: Readonly<Record<TypeStillRole, string>> = Object.freeze({
  aa: 'display',
  line: 'body',
});

/**
 * The catalog's role map (lead A, 2026-10-29, P-5 slice 3): each still shows its pack's
 * signature role where the default would repeat another pack's still byte for byte. Console
 * Mono and Drafting Grotesk set their line in their label role, since their body faces are
 * Field Serif's and Paste-Up's; Field Serif sets its "Aa" in its Fraunces Italic quote role and
 * its line in its display role, since Book Serif shares its display face and three packs its
 * body face; Technical Sans and Mono sets its line in its title role, its Plex SemiBold, since
 * its body is a system face, which gets no still, and a Plex Medium line can't be told from
 * Drafting Grotesk's label line at 18px (Mono (b), lead A, 2026-10-30; B's strip review).
 * Every other pack keeps the defaults. This is the only place a
 * pack's still roles are named: `pnpm stills:type` shoots from it, the build checks against it,
 * and the row's caption and alt text say it, so a future pack that shares a face fails the test
 * that no two stills are byte-identical rather than slipping in as a duplicate.
 */
export const TYPE_STILL_FACES: Readonly<
  Record<string, Readonly<Partial<Record<TypeStillRole, string>>>>
> = Object.freeze({
  'console-mono': Object.freeze({ line: 'label' }),
  'drafting-grotesk': Object.freeze({ line: 'label' }),
  'field-serif': Object.freeze({ aa: 'quote', line: 'display' }),
  'technical-sans-mono': Object.freeze({ line: 'title' }),
});

/** The manifest role `pack`'s `still` sets, by the role map. */
export function stillFace(pack: string, still: TypeStillRole): string {
  return TYPE_STILL_FACES[pack]?.[still] ?? TYPE_STILL_DEFAULT_FACE[still];
}

/** How the row's caption and alt text say a still's role: "its quote face". */
export function faceWords(face: string): string {
  return `its ${face.replace(/-/g, ' ')} face`;
}

/**
 * The live row's geometry each still is shot at, in CSS pixels at a 16px
 * root: "Aa" at 26px in a 34px line, the sample at 13px on an 18px line,
 * with 2px either side so no glyph's overhang is clipped (A P2-G). The row
 * sizes a still in rem from these, so it scales with text at 200% (A N-7).
 */
export const TYPE_STILL_GEOMETRY: Readonly<
  Record<TypeStillRole, { readonly fontPx: number; readonly linePx: number }>
> = Object.freeze({
  aa: Object.freeze({ fontPx: 26, linePx: 34 }),
  line: Object.freeze({ fontPx: 13, linePx: 18 }),
});

/** The padding each side of a still's text, in CSS pixels. */
export const TYPE_STILL_SIDE_PX = 2;

/** The device pixel ratio stills are shot at, so they stay crisp on a 2x screen. */
export const TYPE_STILL_DPR = 2;

/** One still, as its record lists it. */
export interface TypeStillEntry {
  readonly pack: string;
  readonly role: TypeStillRole;
  /** Its file in the record's directory: `<pack>.<role>.png`. */
  readonly file: string;
  readonly text: string;
  /** Its CSS size, in pixels at a 16px root. */
  readonly width: number;
  readonly height: number;
  /** Its pixel size, at TYPE_STILL_DPR. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bytes: number;
  /** The hex SHA-256 of its bytes. */
  readonly sha256: string;
  /** The face it sets: its family, weight, style, and tracking, as the pack's role gives them. */
  readonly face: {
    /** The manifest role it sets, by the catalog's role map: "display", "quote". */
    readonly role: string;
    readonly family: string;
    readonly weight: number;
    readonly style: 'normal' | 'italic';
    readonly tracking: string;
  };
  /** The woff2 files it was shot from, by repository path, with each one's SHA-256. */
  readonly sources: readonly { readonly file: string; readonly sha256: string }[];
}

/** The record `pnpm stills:type` writes beside the stills. */
export interface TypeStillRecord {
  readonly version: 1;
  readonly generator: string;
  readonly dpr: number;
  /**
   * Why no still is shot yet, as the lead ruled it, on a record that lists none: the build
   * then serves no still, and every self-hosted row has none (`stills: null`). A record that
   * lists stills has no `unshot`, and lists every one.
   */
  readonly unshot?: string;
  readonly stills: readonly TypeStillEntry[];
}

/** A still as a type row draws it: where it's served, its size in rem, and its alt text. */
export interface TypeStillRef {
  readonly url: string;
  /** Its CSS size in rem, so it scales with the root's text size. */
  readonly widthRem: number;
  readonly heightRem: number;
  readonly bytes: number;
  /**
   * The pack's name, the role it shows and the pack's character, as the lead's ruling words
   * it: "Field Serif: its quote face, serif".
   */
  readonly alt: string;
  /** The manifest role the still sets, by the catalog's role map: "quote". */
  readonly face: string;
  /** Its caption: the role in plain words, "its quote face". */
  readonly caption: string;
}

/** A pack's two stills. */
export interface TypeStills {
  readonly aa: TypeStillRef;
  readonly line: TypeStillRef;
}

/** A still's file name where it's served: `<pack>-<role>.<sha256-12>.png`. */
export function servedStillName(entry: Pick<TypeStillEntry, 'pack' | 'role' | 'sha256'>): string {
  return `${entry.pack}-${entry.role}.${entry.sha256.slice(0, 12)}.png`;
}

/** Where the host serves a still. */
export function servedStillUrl(entry: Pick<TypeStillEntry, 'pack' | 'role' | 'sha256'>): string {
  return `${STUDIO_ASSET_URL}${servedStillName(entry)}`;
}

/** A pack's character, as its picker words it: sans, serif, or mono. */
export type TypeStyle = 'sans' | 'serif' | 'mono';

/**
 * The style of a stack: the generic family it ends in, mono for monospace,
 * serif for serif, and sans for anything else, sans-serif or system-ui.
 */
export function typeStyleOf(stack: string): TypeStyle {
  const generic =
    stack
      .split(',')
      .at(-1)
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? '';
  if (generic === 'monospace') return 'mono';
  if (generic === 'serif') return 'serif';
  return 'sans';
}

/**
 * `stack` without the families a pack self-hosts, so Studio's own document never names a
 * web font it would have to fetch (P-5): "Fraunces", Palatino, Georgia, serif with Fraunces
 * hosted is Palatino, Georgia, serif. Families match by name, quoted or not, in any case. A
 * stack of nothing but hosted families never becomes empty: it becomes the generic family its
 * style names, by `typeStyleOf`, which reads a stack with no generic family as sans.
 */
export function withoutFamilies(stack: string, hosted: Iterable<string>): string {
  const drop = new Set([...hosted].map((family) => family.toLowerCase()));
  if (drop.size === 0) return stack;
  const kept = stack
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !drop.has(part.replace(/^["']|["']$/g, '').toLowerCase()));
  if (kept.length > 0) return kept.join(', ');
  const style = typeStyleOf(stack);
  return style === 'mono' ? 'monospace' : style === 'serif' ? 'serif' : 'sans-serif';
}

const rem = (px: number) => Math.round((px / 16) * 10000) / 10000;

/** Each pack's two stills, from the record, by pack id; a pack missing one has none. */
export function typeStillsByPack(
  record: Pick<TypeStillRecord, 'stills'>,
  names: Readonly<Record<string, { readonly name: string; readonly style: TypeStyle }>>,
): ReadonlyMap<string, TypeStills> {
  const byPack = new Map<string, Partial<Record<TypeStillRole, TypeStillRef>>>();
  for (const entry of record.stills) {
    const known = names[entry.pack];
    if (!known) continue;
    const refs = byPack.get(entry.pack) ?? {};
    const face = stillFace(entry.pack, entry.role);
    refs[entry.role] = {
      url: servedStillUrl(entry),
      widthRem: rem(entry.width),
      heightRem: rem(entry.height),
      bytes: entry.bytes,
      alt: `${known.name}: ${faceWords(face)}, ${known.style}`,
      face,
      caption: faceWords(face),
    };
    byPack.set(entry.pack, refs);
  }
  const both = new Map<string, TypeStills>();
  for (const [pack, refs] of byPack) {
    if (refs.aa && refs.line) both.set(pack, { aa: refs.aa, line: refs.line });
  }
  return both;
}
