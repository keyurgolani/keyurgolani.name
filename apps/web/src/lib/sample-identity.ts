import { detectFormat, parsePortfolio, type Portfolio } from '@portfolio/schema';

// What the bundled sample shows as its own (#1, #12): its person's name, its
// pages' title, and its share image. A real deployment can't publish any of
// them as its own, so startup refuses each in production, and `pnpm
// config:validate` warns about it. The values come from the bundled example
// itself, read as the server reads a portfolio, never from a list kept beside
// it. This module imports nothing server-only, for config:validate.

/** What a sample shows as its own. */
export interface SampleIdentity {
  /** identity.name. */
  readonly name: string;
  /** meta.title, when it has one. */
  readonly title?: string;
  /** The source of the media entry meta.ogImage places, when it places one. */
  readonly ogImage?: string;
}

/** A field of a portfolio that is a bundled sample's. */
export interface SampleField {
  /** JSON pointer into the portfolio document. */
  readonly pointer: '/identity/name' | '/meta/title' | '/meta/ogImage';
  /** The same field, as a parsed source's locate() takes it. */
  readonly path: readonly string[];
}

/** What `portfolio` shows as its own. */
export function sampleIdentityOf(portfolio: Portfolio): SampleIdentity {
  const title = portfolio.meta?.title;
  const ogImage = ogImageSource(portfolio);
  return {
    name: portfolio.identity.name,
    ...(title === undefined ? {} : { title }),
    ...(ogImage === undefined ? {} : { ogImage }),
  };
}

/**
 * The bundled sample's identity, from its portfolio document's text, or
 * undefined when it doesn't read: a broken build, which startup refuses in
 * production rather than check against nothing.
 */
export function bundledSample(text: string, fileName: string): SampleIdentity | undefined {
  const parsed = parsePortfolio(text, detectFormat(fileName), { name: fileName });
  return parsed.ok ? sampleIdentityOf(parsed.value) : undefined;
}

/**
 * Each field of `portfolio` that is one of `samples`': the name and the
 * title ignoring case, spacing, and Unicode form, and the share image by
 * the source its media entry names, whatever the entry's id.
 */
export function sampleFields(
  portfolio: Portfolio,
  samples: readonly SampleIdentity[],
): SampleField[] {
  const own = sampleIdentityOf(portfolio);
  const fields: SampleField[] = [];
  if (samples.some(({ name }) => sameText(name, own.name))) {
    fields.push({ pointer: '/identity/name', path: ['identity', 'name'] });
  }
  if (own.title !== undefined && samples.some(({ title }) => sameText(title, own.title))) {
    fields.push({ pointer: '/meta/title', path: ['meta', 'title'] });
  }
  if (own.ogImage !== undefined && samples.some(({ ogImage }) => ogImage === own.ogImage)) {
    fields.push({ pointer: '/meta/ogImage', path: ['meta', 'ogImage'] });
  }
  return fields;
}

function sameText(sample: string | undefined, value: string | undefined): boolean {
  return sample !== undefined && value !== undefined && normalize(sample) === normalize(value);
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function ogImageSource(portfolio: Portfolio): string | undefined {
  const asset = portfolio.meta?.ogImage?.asset;
  if (asset === undefined) return undefined;
  return portfolio.media?.find(({ id }) => id === asset)?.source;
}
