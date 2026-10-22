import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodTypeAny } from 'zod';
import { DisplayModeSchema } from '@portfolio/schema';
import { PreviewEnvironmentSchema } from '~/server/operations';
import {
  envelope,
  FRAME_HANDSHAKE,
  isRoute,
  LIMITS,
  PROTOCOL,
  PROTOCOL_VERSION,
  readMessage,
  sizeOf,
  STUDIO_HANDSHAKE,
  TO_FRAME,
  TO_STUDIO,
} from './protocol';

// The preview's message protocol (#7, Slice 3): per message type, a valid
// message reads, and a wrong version, an unknown type, an oversized message,
// and an invalid payload each read as dropped, for the reason that's first
// wrong with it. The channels' own tests (studio-channel.test.ts and
// frame-channel.test.ts) check the windows, nonces, and origins, and that a
// drop has no side effect.

const KIB = 1024;
const MIB = 1024 * KIB;
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

/** A blob that says it's `size` bytes without holding them. */
class SizedBlob extends Blob {
  readonly #size: number;
  constructor(size: number) {
    super([]);
    this.#size = size;
  }
  override get size() {
    return this.#size;
  }
}

const SOURCE = { name: 'portfolio.yml', format: 'yaml', text: 'schemaVersion: 3\n' } as const;

/** A valid payload of every type, by table. */
const VALID = {
  hello: { nonce: TOKEN, instance: TOKEN },
  connect: {},
  ready: { renderedVersion: 4, route: '/' },
  navigated: { route: '/work/small-traces' },
  scrolled: { anchor: 'selected-work', progress: 0.25 },
  link: { href: 'https://example.test/talk', kind: 'external' },
  rect: { anchor: 'contact', rect: { x: 0, y: -40.5, width: 390, height: 812 } },
  status: { state: 'render_failed', correlationId: '1234567890' },
  environment: { displayMode: 'dark', contrast: 'more', motion: 'reduce', enhancement: 'off' },
  'scroll-to': { anchor: 'contact', progress: 1, seq: 7 },
  navigate: { route: '/work/small-traces' },
  lifecycle: { state: 'hidden', focused: false },
  sync: { scroll: true },
  document: {
    sources: { portfolio: SOURCE, site: { ...SOURCE, name: 'site.yml' } },
    selection: { variant: 'fallback', displayMode: 'dark' },
    media: { schemaVersion: 1, assets: [] },
    snapshots: { github: { kind: 'github' } },
  },
  asset: { key: 'media/portrait.png', blob: new SizedBlob(5 * MIB) },
} as const;

/** A payload the type's schema refuses, by type. */
const INVALID: Record<string, unknown> = {
  hello: { nonce: 'short', instance: TOKEN },
  connect: { port: 1 },
  ready: { renderedVersion: 0, route: '/' },
  navigated: { route: 'work' },
  scrolled: { anchor: 'Not An Id', progress: 0.5 },
  link: { href: 'javascript:alert(1)', kind: 'external' },
  rect: { anchor: 'contact', rect: { x: Number.NaN, y: 0, width: 1, height: 1 } },
  status: { state: 'broken' },
  environment: { displayMode: 'sepia', contrast: 'more', motion: 'reduce', enhancement: 'off' },
  'scroll-to': { anchor: 'contact', progress: 1.5, seq: 7 },
  navigate: { route: '/../studio' },
  lifecycle: { state: 'visible' },
  sync: { scroll: 'yes' },
  document: { sources: { portfolio: SOURCE }, selection: {} },
  asset: { key: '', blob: new SizedBlob(1) },
};

const TABLES: ReadonlyArray<readonly [string, Readonly<Record<string, ZodTypeAny>>]> = [
  ['the hello Studio takes', STUDIO_HANDSHAKE],
  ['the connect a frame takes', FRAME_HANDSHAKE],
  ['what a frame sends Studio', TO_STUDIO],
  ['what Studio sends a frame', TO_FRAME],
];

const message = (type: string, payload: unknown, extra: Record<string, unknown> = {}) => ({
  ...envelope(type, payload, 1),
  ...extra,
});

test('every message type reads when valid, and drops for a wrong version, an unknown type, an oversized message, or an invalid payload (#7, Slice 3)', () => {
  for (const [name, table] of TABLES) {
    const types = Object.keys(table);
    assert.ok(types.length > 0, name);
    for (const type of types) {
      const valid = VALID[type as keyof typeof VALID];
      assert.ok(valid !== undefined, `a valid ${type}`);
      const read = readMessage(message(type, valid), table);
      assert.ok(read.ok, `${name}: ${type} ${JSON.stringify(read)}`);
      assert.equal(read.message.type, type);
      assert.equal(read.message.seq, 1);
      const dropped = (data: unknown) => {
        const result = readMessage(data, table);
        return result.ok ? 'read' : result.reason;
      };
      const what = `${name}: ${type}`;
      assert.equal(dropped(message(type, valid, { version: 2 })), 'version', what);
      assert.equal(dropped(message(type, valid, { version: '1' })), 'version', what);
      assert.equal(dropped(message(`${type}-x`, valid)), 'type', what);
      const over = type === 'document' ? LIMITS.document : LIMITS.message;
      const padded = { ...(valid as object), pad: 'x'.repeat(over) };
      assert.equal(dropped(message(type, padded)), 'size', what);
      assert.equal(dropped(message(type, INVALID[type])), 'payload', what);
      assert.equal(dropped(message(type, { ...(valid as object), extra: true })), 'payload', what);
      assert.equal(dropped(message(type, valid, { seq: 0 })), 'payload', what);
      assert.equal(dropped(message(type, valid, { sender: 'studio' })), 'payload', what);
      assert.equal(dropped({ ...message(type, valid), protocol: 'other' }), 'envelope', what);
    }
  }
  // A type is read only where its side takes it.
  assert.equal(readMessage(message('hello', VALID.hello), TO_STUDIO).ok, false);
  assert.equal(readMessage(message('environment', VALID.environment), TO_STUDIO).ok, false);
  assert.equal(readMessage(message('ready', VALID.ready), TO_FRAME).ok, false);
  for (const data of [null, 'kgn-preview', [PROTOCOL], { type: 'hello' }, 7]) {
    const read = readMessage(data, STUDIO_HANDSHAKE);
    assert.equal(read.ok ? 'read' : read.reason, 'envelope', JSON.stringify(data));
  }
  assert.equal(PROTOCOL_VERSION, 1);
});

test('the limits are 64 KiB a message, 4 MiB a document, 20 MiB a blob, and 100 MiB a frame, and a message at its limit reads (#7, Slice 3)', () => {
  assert.deepEqual(
    { ...LIMITS },
    { message: 64 * KIB, document: 4 * MIB, blob: 20 * MIB, frame: 100 * MIB },
  );
  /** A message of `type` whose text at `path` fills it to exactly `bytes`. */
  const filled = (table: object, type: string, payload: object, path: string, bytes: number) => {
    const filledPayload = structuredClone(payload) as Record<string, unknown>;
    const keys = path.split('.');
    let at = filledPayload;
    for (const key of keys.slice(0, -1)) at = at[key] as Record<string, unknown>;
    const last = keys.at(-1)!;
    at[last] = '';
    const base = sizeOf(message(type, filledPayload), Number.MAX_SAFE_INTEGER);
    at[last] = 'x'.repeat(bytes - base);
    const full = message(type, filledPayload);
    assert.equal(sizeOf(full, Number.MAX_SAFE_INTEGER), bytes, `${type} at ${bytes}`);
    return readMessage(full, table as typeof TO_FRAME);
  };
  const documentPayload = structuredClone({ ...VALID.document, media: undefined });
  delete (documentPayload as { media?: unknown }).media;
  assert.ok(filled(TO_FRAME, 'document', documentPayload, 'sources.portfolio.text', 4 * MIB).ok);
  const over = filled(TO_FRAME, 'document', documentPayload, 'sources.portfolio.text', 4 * MIB + 1);
  assert.equal(over.ok ? 'read' : over.reason, 'size');
  const atLimit = filled(
    TO_STUDIO,
    'status',
    { state: 'ready', correlationId: 'x' },
    'pad',
    64 * KIB,
  );
  // The pad makes the payload invalid, but only once the size check passed.
  assert.equal(atLimit.ok ? 'read' : atLimit.reason, 'payload');
  const pastLimit = filled(TO_STUDIO, 'status', { state: 'ready' }, 'pad', 64 * KIB + 1);
  assert.equal(pastLimit.ok ? 'read' : pastLimit.reason, 'size');
  // A blob counts against its own limit, not the message's.
  const blob = (size: number) =>
    readMessage(message('asset', { key: 'media/a.png', blob: new SizedBlob(size) }), TO_FRAME);
  assert.ok(blob(20 * MIB).ok);
  const big = blob(20 * MIB + 1);
  assert.equal(big.ok ? 'read' : big.reason, 'size');
  // Anywhere else, a blob isn't plain data.
  const elsewhere = readMessage(
    message('document', { ...VALID.document, media: new SizedBlob(1) }),
    TO_FRAME,
  );
  assert.equal(elsewhere.ok ? 'read' : elsewhere.reason, 'payload');
});

test('a message is measured as plain data: UTF-8 bytes for text, and anything else, a cycle, or a value reached twice is invalid (#7, Slice 3)', () => {
  assert.equal(sizeOf('abc', 100), 3);
  assert.equal(sizeOf('é', 100), 2);
  assert.equal(sizeOf('€', 100), 3);
  assert.equal(sizeOf('😀', 100), 4);
  assert.equal(sizeOf({ ab: 'cd' }, 100), 5);
  assert.equal(sizeOf([1, true, null, undefined], 100), 12);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(sizeOf(cyclic, 100), -1);
  const shared = { a: 1 };
  assert.equal(sizeOf({ x: shared, y: shared }, 100), -1);
  let deep: unknown = 'leaf';
  for (let i = 0; i < 40; i++) deep = [deep];
  assert.equal(sizeOf(deep, 1000), -1);
  for (const value of [new Date(0), new Map(), new Set(), new Uint8Array(4), /x/, 10n, () => 1]) {
    assert.equal(sizeOf(value, 100), -1, String(value));
  }
  assert.equal(sizeOf(Object.create(null) as object, 100), 1);
  // Counting stops once past the limit: a vast sparse array never gets walked.
  assert.ok(sizeOf(new Array(1e9), 64 * KIB) > 64 * KIB);
  assert.ok(sizeOf('x'.repeat(10 * MIB), 64 * KIB) > 64 * KIB);
});

test('a route is a path below the link base, with no empty, dot, or encoded dot segment, and no query or fragment (#7, Slice 3)', () => {
  for (const route of [
    '/',
    '/work',
    '/work/small-traces',
    '/w%C3%B6rk',
    "/a-b_c.d~e!$&'()*+,;=:@",
  ]) {
    assert.ok(isRoute(route), route);
  }
  for (const route of [
    '',
    'work',
    '//work',
    '/work/',
    '/work//x',
    '/.',
    '/..',
    '/work/../studio',
    '/%2e%2e',
    '/%2E',
    '/.%2e',
    '/work?x=1',
    '/work#x',
    '/work\\x',
    '/work x',
    `/${'x'.repeat(1024)}`,
  ]) {
    assert.ok(!isRoute(route), route);
  }
});

test("the environment message takes exactly the values a grant's environment does, display modes as the schema has them (#7, Slice 3)", () => {
  const { shape } = TO_FRAME.environment;
  const grant = PreviewEnvironmentSchema.shape;
  assert.deepEqual(Object.keys(shape), Object.keys(grant));
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    assert.deepEqual(shape[key].options, grant[key].options, key);
  }
  assert.deepEqual(shape.displayMode.options, DisplayModeSchema.options);
});

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** The app modules `file` imports at run time, `~/` and relative alike; type-only imports bring no code. */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers = [
    ...text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gm),
    ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map(([, specifier]) => specifier!);
  const found: string[] = [];
  for (const specifier of specifiers) {
    const base = specifier.startsWith('~/')
      ? path.join(SRC, specifier.slice(2))
      : specifier.startsWith('.')
        ? path.resolve(path.dirname(file), specifier)
        : null;
    if (!base) continue;
    const resolved = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
      .map((suffix) => `${base}${suffix}`)
      .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
    if (resolved) found.push(resolved);
  }
  return found;
}

/** Every app module `entry` loads at run time, itself included. */
function reached(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...runtimeImports(file));
  }
  return seen;
}

test("neither proxy.ts nor the route table loads the protocol or either channel, through ~/ imports too, so the proxy's bundle never carries them (#7, Slice 3)", () => {
  const kept = ['preview/protocol.ts', 'preview/studio-channel.ts', 'preview/frame-channel.ts'];
  for (const entry of ['proxy.ts', 'server/routes.ts']) {
    const seen = reached(path.join(SRC, entry));
    assert.ok(seen.size > 1, `${entry} reaches the app's other modules`);
    for (const file of kept) assert.ok(!seen.has(path.join(SRC, file)), `${entry} loads ${file}`);
  }
  // The walk does follow ~/ imports: the grant layout reaches the agent's channel through one.
  const layout = reached(path.join(SRC, 'app/(preview)/preview/[grant]/layout.tsx'));
  assert.ok(layout.has(path.join(SRC, 'preview/frame-channel.ts')));
  assert.ok(!layout.has(path.join(SRC, 'preview/studio-channel.ts')));
});
