import { z } from 'zod';
import { isSectionId } from '@portfolio/schema/ids';

// The preview's message protocol (#7, Slice 3): every message between Studio
// and a preview frame, as one zod schema both sides read with. A message is
// an envelope, { protocol: 'kgn-preview', version: 1, seq, type, payload },
// and each side numbers its own from 1.
//
// The handshake goes between the windows. A frame's document has an opaque
// origin, so its messages arrive with origin "null" and Studio tells its
// frame by the window instead: on every load the agent posts `hello` to
// window.parent, for Studio's origin alone, with the frame's channel nonce
// (the grant's, which the server renders, or the one Studio put in a local
// shell's fragment) and an id its document makes for itself. Studio takes it
// only from that frame's own contentWindow, with that frame's current nonce,
// and answers `connect` with a MessagePort. The agent takes `connect` only
// from window.parent, from Studio's origin. Everything else goes over the
// port.
//
// Each side drops what it doesn't take, with no side effect, and counts it:
// a message from the wrong window or origin, with the wrong nonce, not this
// protocol, another version, a type that side doesn't take, over its size,
// or with a payload its schema refuses. Nothing here touches the DOM, so
// both sides and Node tests read with the same code.

export const PROTOCOL = 'kgn-preview';
export const PROTOCOL_VERSION = 1;

const KIB = 1024;
const MIB = 1024 * KIB;

/** What a message may hold (Slice 3, item 4). sizeOf() says how a message is measured. */
export const LIMITS = Object.freeze({
  /** Any message but a local `document`, and an `asset` but its blob. */
  message: 64 * KIB,
  /** A local `document`: its sources, selection, media document, and snapshots. */
  document: 4 * MIB,
  /** One `asset`'s blob. */
  blob: 20 * MIB,
  /** Everything one frame takes in `document` and `asset` messages, all told. */
  frame: 100 * MIB,
});

/** The most `scrolled` messages a frame sends, and Studio takes, in any second. */
export const SCROLLED_PER_SECOND = 10;

/** Why a side dropped a message. */
export const DROP_REASONS = [
  /** From a window that isn't the other side's. */
  'source',
  /** A `connect` from an origin that isn't Studio's. */
  'origin',
  /** A `hello` with a nonce that isn't the frame's current one. */
  'nonce',
  /** Not an envelope of this protocol. */
  'envelope',
  /** This protocol, another version. */
  'version',
  /** A type this side doesn't take, here or in its mode. */
  'type',
  /** Over its size limit, or past the frame's total. */
  'size',
  /** A payload its schema refuses, or anything but plain data. */
  'payload',
  /** A message this side doesn't take now, such as a `connect` before its `hello`. */
  'state',
  /** A `scrolled` past SCROLLED_PER_SECOND. */
  'rate',
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** One dropped message, as the test hook sees it. */
export interface PreviewDrop {
  readonly side: 'studio' | 'frame';
  readonly reason: DropReason;
  /** Its type, once the envelope said one. */
  readonly type?: string;
}

declare global {
  /**
   * Set by tests to see every message either side drops, as the kit's
   * __portfolioFailEnhancements is set to make enhancements fail. Unset, a
   * drop costs nothing but its count.
   */
  var __kgnPreviewDrop: ((drop: PreviewDrop) => void) | undefined;
}

/** Tells the test hook, when a test set one, that `drop` happened. */
export function reportDrop(drop: PreviewDrop): void {
  const hook = globalThis.__kgnPreviewDrop;
  if (typeof hook === 'function') hook(drop);
}

/** A channel nonce, or a document's own id: 128 random bits in base64url, as a grant's nonce is minted. */
export const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const Token = z.string().regex(TOKEN);

/** A section id, which `scroll-to`, `scrolled`, and `rect` name. #10 adds item ids. */
const Anchor = z.string().refine(isSectionId);

/** Where a fraction of the way through its anchor is: 0 at its top, 1 at its end. */
const Progress = z.number().min(0).max(1);

const PATH_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;
/** A dot segment, spelled out or percent-encoded, which URL parsing would resolve away. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * Whether `route` is a path below a frame's link base: `/`, or `/` then
 * path segments, with no empty or dot segment and no query or fragment, so
 * it names the same place under any base.
 */
export function isRoute(route: string): boolean {
  if (route === '/') return true;
  if (!route.startsWith('/') || route.length > 1024) return false;
  return route
    .slice(1)
    .split('/')
    .every((segment) => PATH_SEGMENT.test(segment) && !DOT_SEGMENT.test(segment));
}
const Route = z.string().refine(isRoute);

/** The schemes a `link` may name, which Studio may open on an explicit click. */
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const LinkHref = z
  .string()
  .max(2048)
  .refine((href) => {
    try {
      return LINK_SCHEMES.has(new URL(href).protocol);
    } catch {
      return false;
    }
  });

/** The frame's environment (Slice 4's controls), as a grant holds it. */
const Environment = z
  .object({
    displayMode: z.enum(['system', 'light', 'dark', 'high-contrast']),
    contrast: z.enum(['system', 'more']),
    motion: z.enum(['system', 'reduce']),
    enhancement: z.enum(['on', 'off']),
  })
  .strict();

const Coordinate = z.number().finite().min(-1e7).max(1e7);
const Extent = z.number().finite().min(0).max(1e7);

/** A document a local frame renders, as #4 reads one: its file name, format, and text. */
const SourceDocument = z
  .object({
    name: z.string().min(1).max(255),
    format: z.enum(['yaml', 'json']),
    text: z.string(),
  })
  .strict();

/** What `hello` carries. */
export const HelloSchema = z
  .object({
    nonce: Token,
    /** The id the frame's document made for itself when it loaded. */
    instance: Token,
  })
  .strict();

/** The window messages Studio takes: the handshake's first half. */
export const STUDIO_HANDSHAKE = { hello: HelloSchema } as const;

/** The window messages a frame takes: `connect`, which brings the port. */
export const FRAME_HANDSHAKE = { connect: z.object({}).strict() } as const;

/** What the frame sends Studio over the port (Slice 3, item 3). */
export const TO_STUDIO = {
  /**
   * The frame rendered and holds its port: the version it renders, a draft
   * grant's pinned version or a local document's, or null for a revision or
   * a fixture, and its route below the link base.
   */
  ready: z
    .object({
      renderedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
      route: Route,
    })
    .strict(),
  /** The frame is going to `route`: a document load in server mode, a route kept in memory in local mode. */
  navigated: z.object({ route: Route }).strict(),
  /** Where the reader is, while scroll sync is on, at most SCROLLED_PER_SECOND times a second. */
  scrolled: z.object({ anchor: Anchor, progress: Progress }).strict(),
  /** A link the frame cancelled instead of following, for Studio to show. */
  link: z
    .object({
      href: LinkHref,
      kind: z.enum(['external', 'live', 'mailto', 'tel', 'download']),
    })
    .strict(),
  /** Where an anchor `scroll-to` named is, in the frame's viewport, for Studio to outline. */
  rect: z
    .object({
      anchor: Anchor,
      rect: z.object({ x: Coordinate, y: Coordinate, width: Extent, height: Extent }).strict(),
    })
    .strict(),
  /** A state Studio shows instead of the frame's own `ready`. */
  status: z
    .object({
      state: z.enum(['ready', 'render_failed', 'unavailable', 'version_mismatch']),
      /** The reference the server log carries for a render failure. */
      correlationId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/)
        .optional(),
    })
    .strict(),
} as const;

/** What Studio sends the frame over the port (Slice 3, item 3). */
export const TO_FRAME = {
  /** The environment to render under. Slice 4 applies it. */
  environment: Environment,
  /** Scroll `anchor` into view, `progress` of the way through it, without moving focus. */
  'scroll-to': z
    .object({
      anchor: Anchor,
      progress: Progress,
      /** The sync step that asked for it, so the scroll it causes isn't sent back. */
      seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  /** Go to `route` below the link base, and nowhere else. */
  navigate: z.object({ route: Route }).strict(),
  /** Whether the frame shows and has the user's attention, for #6's runtime to pause on. */
  lifecycle: z
    .object({ state: z.enum(['visible', 'hidden']), focused: z.boolean() })
    .strict(),
  /** Whether the frame sends `scrolled`: scroll sync, off until Studio turns it on (Slice 5). */
  sync: z.object({ scroll: z.boolean() }).strict(),
  /** A local frame's document (Slice 6): #4's sources, the selection, and #10's media and snapshots. */
  document: z
    .object({
      sources: z.object({ portfolio: SourceDocument, site: SourceDocument }).strict(),
      selection: z.record(z.string().regex(/^[A-Za-z]{1,32}$/), z.string().max(128)),
      media: z.unknown().optional(),
      snapshots: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), z.unknown()).optional(),
    })
    .strict(),
  /** One local image or file (Slice 6), by `media[].source` for an import or its rendition path otherwise. */
  asset: z
    .object({
      key: z.string().min(1).max(1024),
      blob: z.instanceof(Blob).refine((blob) => blob.size <= LIMITS.blob),
    })
    .strict(),
} as const;

/** The types only a local frame takes. */
export const LOCAL_ONLY: ReadonlySet<string> = new Set(['document', 'asset']);

type Table = Readonly<Record<string, z.ZodTypeAny>>;
export type ToStudioType = keyof typeof TO_STUDIO;
export type ToFrameType = keyof typeof TO_FRAME;
export type Payload<T extends Table, K extends keyof T> = z.infer<T[K]>;
export type ToStudioPayload<K extends ToStudioType> = Payload<typeof TO_STUDIO, K>;
export type ToFramePayload<K extends ToFrameType> = Payload<typeof TO_FRAME, K>;

/** A message as one side sends it. */
export interface Envelope<K extends string = string, P = unknown> {
  readonly protocol: typeof PROTOCOL;
  readonly version: typeof PROTOCOL_VERSION;
  readonly seq: number;
  readonly type: K;
  readonly payload: P;
}

/** The envelope for `payload`, the sender's `seq`th message. */
export function envelope<K extends string, P>(type: K, payload: P, seq: number): Envelope<K, P> {
  return { protocol: PROTOCOL, version: PROTOCOL_VERSION, seq, type, payload };
}

const Seq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** A message read with a table: what it says, or why it was dropped. */
export type Read<T extends Table> =
  | {
      readonly ok: true;
      readonly message: {
        readonly [K in keyof T & string]: {
          readonly type: K;
          readonly seq: number;
          readonly payload: z.infer<T[K]>;
        };
      }[keyof T & string];
    }
  | { readonly ok: false; readonly reason: DropReason; readonly type?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads `data`, a message as it arrived, against `table`, the types this
 * side takes here: the envelope, then the version, the type, the size, and
 * the payload, in that order, so a message's drop reason is the first thing
 * wrong with it.
 */
export function readMessage<T extends Table>(data: unknown, table: T): Read<T> {
  if (!isRecord(data) || data.protocol !== PROTOCOL) return { ok: false, reason: 'envelope' };
  if (data.version !== PROTOCOL_VERSION) return { ok: false, reason: 'version' };
  const { type } = data;
  if (typeof type !== 'string') return { ok: false, reason: 'envelope' };
  if (!Object.hasOwn(table, type)) return { ok: false, reason: 'type', type };
  const limit = type === 'document' ? LIMITS.document : LIMITS.message;
  const size = sizeOf(data, limit, type === 'asset');
  if (size < 0) return { ok: false, reason: 'payload', type };
  if (size > limit) return { ok: false, reason: 'size', type };
  const parsed = envelopeSchema(table, type).safeParse(data);
  if (!parsed.success) return { ok: false, reason: 'payload', type };
  const { seq, payload } = parsed.data as { seq: number; payload: unknown };
  return { ok: true, message: { type, seq, payload } } as Read<T>;
}

const envelopes = new WeakMap<Table, Map<string, z.ZodTypeAny>>();

/** The whole envelope's schema for a `type` message of `table`, made once. */
function envelopeSchema(table: Table, type: string): z.ZodTypeAny {
  let byType = envelopes.get(table);
  if (!byType) envelopes.set(table, (byType = new Map()));
  let schema = byType.get(type);
  if (!schema) {
    schema = z
      .object({
        protocol: z.literal(PROTOCOL),
        version: z.literal(PROTOCOL_VERSION),
        seq: Seq,
        type: z.literal(type),
        payload: table[type]!,
      })
      .strict();
    byType.set(type, schema);
  }
  return schema;
}

const MAX_DEPTH = 32;

/** The UTF-8 length of `text`, or anything over `budget` once it passes it. */
function utf8Length(text: string, budget: number): number {
  // Every UTF-16 code unit takes at least a byte.
  if (text.length > budget) return budget + 1;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit < 0xdc00 && i + 1 < text.length) {
      // A surrogate pair is one code point of four bytes.
      bytes += 4;
      i++;
    } else bytes += 3;
    if (bytes > budget) return bytes;
  }
  return bytes;
}

/**
 * The size of `value` as the protocol counts it: the UTF-8 length of every
 * string and key, 8 bytes a number, and 1 for anything else that stands
 * alone. A blob counts nothing where `blobs` lets one in, since its own
 * limit applies, and makes the value invalid anywhere else. -1 for anything
 * but plain data: a cycle or any value reached twice, more than 32 levels,
 * or a value that isn't a string, number, boolean, null, undefined, array,
 * or plain object. Counting stops once it passes `limit`.
 */
export function sizeOf(value: unknown, limit: number, blobs = false): number {
  const seen = new Set<object>();
  let total = 0;
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const { value: next, depth } = stack.pop()!;
    if (typeof next === 'string') total += utf8Length(next, limit - total);
    else if (typeof next === 'number') total += 8;
    else if (typeof next === 'boolean' || next === null || next === undefined) total += 1;
    else if (typeof next === 'object') {
      if (depth > MAX_DEPTH || seen.has(next)) return -1;
      seen.add(next);
      if (typeof Blob !== 'undefined' && next instanceof Blob) {
        if (!blobs) return -1;
        continue;
      }
      total += 1;
      if (Array.isArray(next)) {
        // Every item counts at least a byte, a hole too, so a long array is over before it's read.
        if (next.length > limit - total) return limit + 1;
        for (const item of next) stack.push({ value: item, depth: depth + 1 });
      } else {
        const prototype = Object.getPrototypeOf(next);
        if (prototype !== Object.prototype && prototype !== null) return -1;
        for (const key in next) {
          if (!Object.hasOwn(next, key)) continue;
          total += utf8Length(key, limit - total);
          if (total > limit) return total;
          stack.push({ value: (next as Record<string, unknown>)[key], depth: depth + 1 });
        }
      }
    } else return -1;
    if (total > limit) return total;
  }
  return total;
}
