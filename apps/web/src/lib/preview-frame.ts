import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';

// A preview frame's element (#7, Slice 4, items 2, 4, 6, and 7): its sandbox,
// where it loads from, its title, and the viewports Studio simulates, and
// what a frame's appearance override can select (item 7). Pure, so the
// /studio/preview page decides the sandbox on the server and Studio's
// PreviewSurface draws the frame from the same answers.

/** What every preview frame's element carries besides its sandbox. */
export const FRAME_ATTRIBUTES = Object.freeze({
  referrerPolicy: 'no-referrer',
  allow: '',
} as const);

/**
 * The sandbox a preview frame gets. Scripts alone, so the frame runs in an
 * opaque origin. An owner frame on a configured preview origin also gets
 * allow-same-origin, since that origin holds nothing of Studio's; nothing
 * else does, demo included, because with allow-scripts a same-origin page
 * can remove its own sandbox. A frame with JavaScript off gets an empty
 * sandbox, which runs nothing. No frame gets popups, top navigation, forms,
 * modals, or downloads.
 */
export function frameSandbox(
  profile: string,
  previewOrigin: string | null | undefined,
  javascript: boolean,
): string {
  if (!javascript) return '';
  return profile === 'owner' && previewOrigin ? 'allow-scripts allow-same-origin' : 'allow-scripts';
}

/** Where the frame of `grant` loads: below /preview, on the preview origin when one is set. */
export function frameSource(previewOrigin: string | null | undefined, grant: string): string {
  return `${previewOrigin ?? ''}/preview/${grant}`;
}

/**
 * The origin a frame's document has, for Studio's half of the channel to
 * hold its handshake to: the preview origin for a frame with
 * allow-same-origin, which only an owner frame on one gets. A frame
 * without it is opaque, and has none.
 */
export function frameOrigin(
  sandbox: string,
  previewOrigin: string | null | undefined,
): string | undefined {
  if (!previewOrigin || !sandbox.split(/\s+/).includes('allow-same-origin')) return undefined;
  return new URL(previewOrigin).origin;
}

/** A link a frame cancelled, as Studio shows it. */
export interface LinkTarget {
  readonly href: string;
  /** What it is, worked out from the href: `another site`, `a page of this site`, an email or a phone link. */
  readonly description: string;
}

/**
 * What a link a frame sent Studio is, from its href alone, since the
 * frame's own word on it is a claim: a page on another site or on this
 * one, an email link, or a phone link. A page on the preview origin, where
 * only previews are served, is the site's page of the same path, on
 * Studio's origin. Null for anything else, which Studio never offers to
 * open.
 */
export function linkTarget(
  href: string,
  studioOrigin: string,
  previewOrigin?: string | null,
): LinkTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  switch (url.protocol) {
    case 'mailto:':
      return { href: url.href, description: 'an email link' };
    case 'tel:':
      return { href: url.href, description: 'a phone link' };
    case 'http:':
    case 'https:': {
      if (previewOrigin && url.origin === new URL(previewOrigin).origin) {
        const site = new URL(`${url.pathname}${url.search}${url.hash}`, studioOrigin);
        return { href: site.href, description: 'a page of this site' };
      }
      return {
        href: url.href,
        description: url.origin === studioOrigin ? 'a page of this site' : 'another site',
      };
    }
    default:
      return null;
  }
}

/** The media query an owner's system matches when it reduces motion. */
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * `environment` with motion held to what the owner's system allows: reduced
 * when the system reduces it, whatever the controls said. A grant minted
 * before Studio's controls have read the system, as the first one is while
 * the page hydrates, still renders its first paint reduced.
 */
export function heldToSystem<E extends { readonly motion: 'system' | 'reduce' }>(
  environment: E,
  systemReduces: boolean,
): E {
  return systemReduces && environment.motion !== 'reduce'
    ? { ...environment, motion: 'reduce' }
    : environment;
}

/** A viewport Studio simulates: a layout width and a device height, in CSS pixels. */
export interface Viewport {
  readonly id: 'desktop' | 'tablet' | 'mobile' | 'custom';
  readonly width: number;
  readonly height: number;
}

/** The presets: each a width simulation, never the device itself. */
export const VIEWPORTS: readonly Viewport[] = Object.freeze([
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'tablet', width: 1024, height: 768 },
  { id: 'mobile', width: 390, height: 844 },
]);

/** How narrow and wide a custom width may be. */
export const CUSTOM_WIDTH = Object.freeze({ min: 320, max: 2560 });

/** A custom viewport `width` wide, held to CUSTOM_WIDTH, with the desktop preset's height. */
export function customViewport(width: number): Viewport {
  const held = Number.isFinite(width) ? Math.round(width) : CUSTOM_WIDTH.min;
  return {
    id: 'custom',
    width: Math.min(CUSTOM_WIDTH.max, Math.max(CUSTOM_WIDTH.min, held)),
    height: 900,
  };
}

const VIEWPORT_NAMES: Readonly<Record<Viewport['id'], string>> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
  custom: 'Custom',
};

/** A viewport as the controls and the frame's title name it: `Desktop 1440 by 900`. */
export function viewportLabel(viewport: Viewport): string {
  return `${VIEWPORT_NAMES[viewport.id]} ${viewport.width} by ${viewport.height}`;
}

/** What a frame renders, as its title's first part says it. */
export type FrameSubjectKind = 'draft' | 'revision' | 'fixture';

const STATE_STRINGS: Readonly<Record<FrameSubjectKind, string>> = {
  draft: 'Preview — not live',
  revision: 'Preview — live',
  fixture: 'Preview — fixture',
};

/**
 * The frame's title: the state string, then the variant and the viewport,
 * and for one of two compared frames (#7, item 7), which one it is.
 */
export function frameTitle(
  kind: FrameSubjectKind,
  variant: string | null,
  viewport: Viewport,
  which?: 'first' | 'second',
): string {
  const title = `${STATE_STRINGS[kind]}, ${variant ?? 'variant unknown'}, ${viewportLabel(viewport)}`;
  return which ? `${title}, ${which} of two` : title;
}

/** Something a frame's appearance override can select, by its manifest's id and name. */
export interface AppearanceOption {
  readonly id: string;
  readonly name: string;
}

/** What this build registers for each part of an appearance a frame's override sets (#7, item 7). */
export interface AppearanceOptions {
  /** The variants a site can select: the fallback composition is never one. */
  readonly variants: readonly AppearanceOption[];
  readonly designLanguages: readonly AppearanceOption[];
  readonly colorSchemes: readonly AppearanceOption[];
  readonly typography: readonly AppearanceOption[];
}

/**
 * The composition that renders for a selection of `selected`: it, when this
 * build registers it, and else the fallback composition, or null when the
 * site names none.
 */
export function renderedVariant(
  selected: string | null,
  registered: readonly AppearanceOption[],
): string | null {
  if (selected === null) return null;
  return registered.some(({ id }) => id === selected) ? selected : FALLBACK_VARIANT_ID;
}

/**
 * How much the frame scales to fit `available` CSS pixels of width: never
 * up, so the layout width inside stays the viewport's.
 */
export function fitScale(available: number, viewport: Pick<Viewport, 'width'>): number {
  if (!(available > 0)) return 1;
  return Math.min(1, available / viewport.width);
}
