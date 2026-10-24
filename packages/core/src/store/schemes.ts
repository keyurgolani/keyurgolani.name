import { createHash } from 'node:crypto';
import { canonicalize, isPlainObject } from '@portfolio/schema';
import { MEDIA_LIMITS } from '../catalog/media/limits';
import type { GeneratorDeclaration, SchemeGenerators, SchemeInput } from '../catalog/schemes';
import type { UnitDiagnostic } from '../catalog/unit';
import { recordOwnerModule } from '../load-trace';
import type { SharpLoad } from '../catalog/media/derive';
import type { AssetStore } from './assets';
import type { Sha256 } from './layout';

// Generated color schemes (#10, 10h): when a draft's site selects a color
// scheme whose manifest declares a generator, a draft save runs it on the
// site's appearanceInputs entry for that scheme, and the draft holds the
// result as derived.schemes[schemeId]; a publish freezes it into the
// revision's snapshots/schemes.json. The build hands the store its
// generators, as it hands it every other check (UnitChecks.schemes), so
// core doesn't depend on @portfolio/appearance. A changed result is a
// `scheme-regenerated` derived change, which the owner accepts before it
// publishes; a first one too, so an image-derived scheme never goes live
// unseen. An asset's pixels come only from the media service's asset store,
// under its caps, never from a fetch.

recordOwnerModule('core/store/schemes');

export type {
  GeneratorDeclaration,
  SchemeGenerators,
  SchemeInput,
  SchemeRun,
} from '../catalog/schemes';

/** A derived.schemes entry, as the store handles it: DerivedScheme, checked by `check`. */
export interface StoredScheme {
  readonly generator: { readonly id: string; readonly version: number };
  readonly inputsHash: string;
  readonly tokens: unknown;
}

/** Why a selected generated scheme has no entry: its id, and what to tell the owner. */
export interface SchemeProblem {
  readonly schemeId: string;
  readonly message: string;
}

const hex = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> => isPlainObject(value);

/**
 * The color schemes a site selects for generation: its colorScheme, and,
 * when a visitor may choose the scheme, each one it gives an
 * appearanceInputs entry. One no longer selected has no entry.
 */
export function selectedSchemes(site: unknown): string[] {
  if (!isRecord(site) || !isRecord(site.appearance)) return [];
  const selected = new Set<string>();
  if (typeof site.appearance.colorScheme === 'string') selected.add(site.appearance.colorScheme);
  const choosable =
    isRecord(site.visitorControls) && site.visitorControls.colorScheme === 'selectable';
  if (choosable && isRecord(site.appearanceInputs)) {
    for (const schemeId of Object.keys(site.appearanceInputs)) selected.add(schemeId);
  }
  return [...selected].sort();
}

/** `site`'s appearanceInputs entry for `schemeId`, when it has one. */
function inputFor(site: unknown, schemeId: string): Record<string, unknown> | undefined {
  if (!isRecord(site) || !isRecord(site.appearanceInputs)) return undefined;
  const input = Object.hasOwn(site.appearanceInputs, schemeId)
    ? site.appearanceInputs[schemeId]
    : undefined;
  return isRecord(input) ? input : undefined;
}

/** The media document's record for `assetId`, when it has one. */
function mediaRecord(media: unknown, assetId: string): Record<string, unknown> | undefined {
  const assets = isRecord(media) && Array.isArray(media.assets) ? media.assets : [];
  return assets.find(
    (record): record is Record<string, unknown> => isRecord(record) && record.assetId === assetId,
  );
}

/**
 * What `declared`'s generator reads for `schemeId`, before any bytes are
 * read: a seed color lowercased, with its hash, or the media record of an
 * asset within the media limits; or why there's none.
 */
function canonicalInput(
  declared: GeneratorDeclaration,
  site: unknown,
  media: unknown,
  schemeId: string,
):
  | {
      readonly ok: true;
      readonly seed?: { readonly color: string; readonly inputsHash: string };
      readonly asset?: Record<string, unknown> & { readonly sha256: string };
    }
  | { readonly ok: false; readonly problem: string } {
  const input = inputFor(site, schemeId);
  if (!input) {
    return {
      ok: false,
      problem: `The site selects ${schemeId}, a generated color scheme, and gives it no appearanceInputs entry.`,
    };
  }
  if (declared.input === 'seed-color') {
    const seed = input.seedColor;
    if (typeof seed !== 'string') {
      return { ok: false, problem: `${schemeId} takes a seedColor in its appearanceInputs entry.` };
    }
    return { ok: true, seed: { color: seed.toLowerCase(), inputsHash: seedInputsHash(seed) } };
  }
  const assetId = input.sourceAsset;
  if (typeof assetId !== 'string' || assetId === '') {
    return { ok: false, problem: `${schemeId} takes a sourceAsset in its appearanceInputs entry.` };
  }
  const record = mediaRecord(media, assetId);
  if (!record || typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) {
    return {
      ok: false,
      problem: `${schemeId} reads the media asset ${assetId}, which has no derived revision yet. Save the draft once its source reads.`,
    };
  }
  const availability = isRecord(record.availability) ? record.availability.state : undefined;
  if (availability === 'unavailable') {
    return {
      ok: false,
      problem: `${schemeId} reads the media asset ${assetId}, whose source is missing.`,
    };
  }
  const bytes = typeof record.bytes === 'number' ? record.bytes : Number.POSITIVE_INFINITY;
  const pixels =
    typeof record.width === 'number' && typeof record.height === 'number'
      ? record.width * record.height
      : Number.POSITIVE_INFINITY;
  if (bytes > MEDIA_LIMITS.sourceBytes || pixels > MEDIA_LIMITS.pixels) {
    return {
      ok: false,
      problem: `${schemeId} reads the media asset ${assetId}, which is over the media limits (20 MiB, 100 megapixels).`,
    };
  }
  return { ok: true, asset: record as Record<string, unknown> & { sha256: string } };
}

/**
 * Reads an asset's stored bytes by their hash, at most `maxBytes`, or null
 * when the store doesn't hold them or they're over it. The media service's
 * asset store, never the network.
 */
export type AssetBytes = (sha256: Sha256, maxBytes: number) => Promise<Uint8Array | null>;

/** `assets` as an AssetBytes: a stored blob read whole, up to its cap, and nothing past it. */
export function assetReader(assets: AssetStore): AssetBytes {
  return async (hash, maxBytes) => {
    const found = await assets.stat(hash);
    if (!found || found.size > maxBytes) return null;
    const stream = await assets.open(hash);
    if (!stream) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.byteLength;
      if (size > maxBytes) {
        stream.destroy();
        return null;
      }
      chunks.push(bytes);
    }
    return new Uint8Array(Buffer.concat(chunks));
  };
}

/**
 * A seed color's input hash: the SHA-256 hex of the seed lowercased, such as
 * `#6750a4` hashed as that exact string, as #20's records hold it. Replace
 * with stream D's helper from #20 PR 3 once it lands.
 */
export function seedInputsHash(seed: string): string {
  return hex(seed.toLowerCase());
}

/** An asset's decoded pixels' hash, or null when they can't be decoded within the media limits. */
export type PixelHash = (bytes: Uint8Array) => Promise<string | null>;

/**
 * An asset's input hash, `pixelsSha256`, as #20's records and
 * example-media/provenance.json hold it: the SHA-256 hex over the decoded
 * pixel rows, RGB, or RGBA when the image has alpha, not over the file's
 * bytes, so a re-encoding of the same pixels is the same input. Decoded by
 * the media service's sharp, under its pixel limit. Replace with stream D's
 * helper from #20 PR 3 once it lands.
 */
export function pixelsSha256(sharp: () => Promise<SharpLoad>): PixelHash {
  return async (bytes) => {
    const load = await sharp();
    if (!load.ok) return null;
    try {
      const { data } = await load
        .sharp(bytes, { limitInputPixels: MEDIA_LIMITS.pixels })
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      return hex(data);
    } catch {
      return null;
    }
  };
}

/**
 * What `declared`'s generator reads for `schemeId`, with its input hash, or
 * why there's none: a seed color as it is, or an asset's stored bytes, read
 * from the asset store within the media limits, hashed by their pixels.
 */
async function resolveInput(
  declared: GeneratorDeclaration,
  site: unknown,
  media: unknown,
  schemeId: string,
  read: { readonly readAsset: AssetBytes; readonly pixelHash: PixelHash },
): Promise<
  | { readonly ok: true; readonly inputsHash: string; readonly input: SchemeInput }
  | { readonly ok: false; readonly problem: string }
> {
  const canonical = canonicalInput(declared, site, media, schemeId);
  if (!canonical.ok) return canonical;
  if (canonical.seed) {
    return {
      ok: true,
      inputsHash: canonical.seed.inputsHash,
      input: { seedColor: canonical.seed.color },
    };
  }
  const assetId = String(canonical.asset?.assetId);
  const bytes = await read.readAsset(`sha256:${canonical.asset!.sha256}`, MEDIA_LIMITS.sourceBytes);
  if (!bytes) {
    return {
      ok: false,
      problem: `${schemeId} reads the media asset ${assetId}, whose stored bytes are missing or over the media limits.`,
    };
  }
  const inputsHash = await read.pixelHash(bytes);
  if (!inputsHash) {
    return {
      ok: false,
      problem: `${schemeId} reads the media asset ${assetId}, whose pixels can't be decoded within the media limits.`,
    };
  }
  return { ok: true, inputsHash, input: { sourceAsset: assetId, bytes } };
}

/**
 * The generated schemes `site` selects, each run now (#10, 10h): what a
 * draft save or an import stores, and why a selected one has none. A
 * scheme without a generator, or one this build doesn't register, has no
 * entry and no problem. A result whose generator isn't the one the manifest
 * declares, or that isn't a whole derived scheme, is never stored.
 */
export async function deriveSchemes({
  site,
  media,
  generators,
  readAsset,
  pixelHash,
}: {
  readonly site: unknown;
  readonly media: unknown;
  readonly generators: SchemeGenerators;
  readonly readAsset: AssetBytes;
  readonly pixelHash: PixelHash;
}): Promise<{
  readonly schemes: Record<string, StoredScheme>;
  readonly problems: SchemeProblem[];
}> {
  const schemes: Record<string, StoredScheme> = {};
  const problems: SchemeProblem[] = [];
  for (const schemeId of selectedSchemes(site)) {
    const declared = generators.declared(schemeId);
    if (!declared) continue;
    const resolved = await resolveInput(declared, site, media, schemeId, { readAsset, pixelHash });
    if (!resolved.ok) {
      problems.push({ schemeId, message: resolved.problem });
      continue;
    }
    const { input } = resolved;
    const run = generators.run(declared, input);
    if (!run.ok) {
      problems.push({ schemeId, message: run.problem });
      continue;
    }
    // Only the generator the registered manifest declares, at its version.
    if (run.generator.id !== declared.id || run.generator.version !== declared.version) {
      problems.push({
        schemeId,
        message: `${schemeId} declares ${declared.id} version ${declared.version}, and the generator answered as ${run.generator.id} version ${run.generator.version}.`,
      });
      continue;
    }
    const entry: StoredScheme = {
      generator: { id: run.generator.id, version: run.generator.version },
      inputsHash: resolved.inputsHash,
      tokens: run.tokens,
    };
    if (!generators.check(entry)) {
      problems.push({
        schemeId,
        message: `${declared.id} gave ${schemeId} tokens that aren't two whole color sets.`,
      });
      continue;
    }
    schemes[schemeId] = entry;
  }
  return { schemes, problems };
}

/**
 * What a publish may freeze of a draft's derived.schemes (#10, 10h), and
 * what blocks it: every scheme the site selects that declares a generator
 * needs an entry that checks, made by that generator at that version, from
 * the input the site gives now, or the live revision's own entry, which a
 * dismissal put back. Entries for a scheme no longer selected go. Pure, so
 * the publish runs no generator and reads no pixels.
 */
export async function frozenSchemes({
  site,
  media,
  stored,
  live,
  generators,
  readAsset,
  pixelHash,
}: {
  readonly site: unknown;
  readonly media: unknown;
  readonly stored: unknown;
  /** The live revision's snapshots/schemes.json. */
  readonly live: unknown;
  readonly generators: SchemeGenerators;
  readonly readAsset: AssetBytes;
  readonly pixelHash: PixelHash;
}): Promise<{
  readonly schemes: Record<string, StoredScheme>;
  readonly problems: SchemeProblem[];
}> {
  const schemes: Record<string, StoredScheme> = {};
  const problems: SchemeProblem[] = [];
  const entries = isRecord(stored) ? stored : {};
  const liveEntries = isRecord(live) ? live : {};
  for (const schemeId of selectedSchemes(site)) {
    const declared = generators.declared(schemeId);
    if (!declared) continue;
    const entry = Object.hasOwn(entries, schemeId) ? entries[schemeId] : undefined;
    const liveEntry = Object.hasOwn(liveEntries, schemeId) ? liveEntries[schemeId] : undefined;
    if (
      entry !== undefined &&
      liveEntry !== undefined &&
      canonicalize(entry) === canonicalize(liveEntry)
    ) {
      schemes[schemeId] = entry as StoredScheme;
      continue;
    }
    const resolved = await resolveInput(declared, site, media, schemeId, { readAsset, pixelHash });
    const generator = isRecord(entry) && isRecord(entry.generator) ? entry.generator : undefined;
    if (
      !generators.check(entry) ||
      generator?.id !== declared.id ||
      generator.version !== declared.version ||
      !resolved.ok ||
      (entry as StoredScheme).inputsHash !== resolved.inputsHash
    ) {
      problems.push({
        schemeId,
        message: resolved.ok
          ? `The draft holds no tokens for ${schemeId} from ${declared.id} version ${declared.version} and the site's input. Save the draft again.`
          : resolved.problem,
      });
      continue;
    }
    schemes[schemeId] = entry as StoredScheme;
  }
  return { schemes, problems };
}

/** A problem as a draft's site document records it: blocks-publish, at the scheme's input. */
export function schemeDiagnostic(site: unknown, problem: SchemeProblem): UnitDiagnostic {
  return {
    code: 'scheme.ungenerated',
    severity: 'blocks-publish',
    document: 'site',
    pointer: inputFor(site, problem.schemeId)
      ? `/appearanceInputs/${problem.schemeId}`
      : '/appearance/colorScheme',
    message: problem.message,
    remediation:
      "Give the scheme an input its generator takes in the site's appearanceInputs, then save the draft, or select another color scheme.",
  };
}

/** A problem as an import reports it: a warning, since the import goes on and the scheme falls back. */
export function schemeWarning(problem: SchemeProblem): UnitDiagnostic {
  return {
    code: 'scheme.dropped',
    severity: 'warning',
    document: 'site',
    pointer: '',
    message: `${problem.message} The import stores no tokens for it, and it renders its fallback.`,
    remediation:
      'Nothing to do for the import. Fix the input, then save a draft in Studio to generate it.',
  };
}
