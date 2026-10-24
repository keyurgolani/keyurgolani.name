import {
  DOCUMENT_MAX_BYTES,
  parseSource,
  serialize,
  yamlComments,
  type DocumentFormat,
  type SourceDocument,
} from '@portfolio/schema';

// The Demo Studio's export (#9, PR 3). Demo only, like the import.
//
//   exportUnit({ sources: { portfolio, site } }, 'yaml' | 'json')
//     -> { files, disclosure }
//
// `files` is two separate documents, portfolio first, named portfolio.yml
// and site.yml or portfolio.json and site.json. Each is written from its
// source's data by #4's serialize(): keys in schema order, two-space indent,
// LF line ends, and a trailing newline. Keys the schema doesn't name, such
// as the ids that key site.sections, routes, appearanceInputs, and
// variantControls and its values, are sorted by UTF-16 code unit, as #4's
// canonicalize() sorts them: every key is sorted first, and serialize()
// puts the ones the schema names back in schema order. No reader gives the
// order of the rest a meaning:
// each map is read by key, and a revision's content hash is over the
// canonical form, where both orders are the same. So the export is pure and
// byte-deterministic: the same models give the same bytes, whatever their
// sources' formatting, key order, or format, and an exported pair imports
// to the same models in both formats. Each document states its
// schemaVersion, and `disclosure.schemaVersions` repeats them.
//
// `disclosure.omitted` lists what the files leave out, as fixed strings:
//
// - `appearance-selection`: the appearance the visitor picks in the demo,
//   which the browser holds outside the site document. The site document
//   keeps the appearance its source has.
// - `local-images`: image files picked in the browser, and the records built
//   from them. They never leave the browser.
// - `yaml-comments`: comments in a YAML source. Only listed when a source
//   has one, since the files are written from the data.
//
// `disclosure.overImportCap` lists each exported document over #4's 1 MiB
// cap, in UTF-8 bytes. Writing a document out can make it longer than its
// source, say pretty JSON from minified, and a file over the cap won't
// import here again, nor into Owner Studio.
//
// The sources are the unit's own, which the import has already read under
// #4's limits, or the sample's. A source that doesn't parse, or has no
// numeric schemaVersion, throws, and the message never quotes it.

export type ExportFormat = 'yaml' | 'json';

export type ExportFile = {
  readonly name: `portfolio.${'yml' | 'json'}` | `site.${'yml' | 'json'}`;
  readonly text: string;
};

export type ExportOmission = 'appearance-selection' | 'local-images' | 'yaml-comments';

export type ExportResult = {
  readonly files: readonly ExportFile[];
  readonly disclosure: {
    readonly schemaVersions: { readonly portfolio: number; readonly site: number };
    readonly omitted: readonly ExportOmission[];
    /** Each exported document over the 1 MiB import cap, which won't import again. */
    readonly overImportCap: readonly ('portfolio' | 'site')[];
  };
};

/** What the browser holds that no export carries, in the order the disclosure lists it. */
export const BROWSER_ONLY_OMISSIONS: readonly ExportOmission[] = [
  'appearance-selection',
  'local-images',
];

export function exportUnit(
  input: { readonly sources: { portfolio: SourceDocument; site: SourceDocument } },
  format: ExportFormat,
): ExportResult {
  const extension = format === 'json' ? 'json' : 'yml';
  const portfolio = dataOf(input.sources.portfolio, 'portfolio');
  const site = dataOf(input.sources.site, 'site');
  const commented = [input.sources.portfolio, input.sources.site].some(
    (source) => source.format === 'yaml' && yamlComments(source.text).length > 0,
  );
  const texts = {
    portfolio: serialize(sortedKeys(portfolio.data), format),
    site: serialize(sortedKeys(site.data), format),
  };
  const encoder = new TextEncoder();
  const overImportCap = (['portfolio', 'site'] as const).filter(
    (document) => encoder.encode(texts[document]).byteLength > DOCUMENT_MAX_BYTES,
  );
  return {
    files: [
      { name: `portfolio.${extension}`, text: texts.portfolio },
      { name: `site.${extension}`, text: texts.site },
    ],
    disclosure: {
      schemaVersions: { portfolio: portfolio.version, site: site.version },
      omitted: [...BROWSER_ONLY_OMISSIONS, ...(commented ? (['yaml-comments'] as const) : [])],
      overImportCap,
    },
  };
}

/**
 * The data with every object's keys sorted by UTF-16 code unit. serialize()
 * then puts the keys the schema names back in schema order, so what this
 * decides is the order of the rest: record maps, and anything inside them.
 */
function sortedKeys(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sortedKeys);
  if (typeof node !== 'object' || node === null) return node;
  const keys = Object.keys(node).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // fromEntries, so an own __proto__ key stays a key.
  return Object.fromEntries(
    keys.map((key) => [key, sortedKeys((node as Record<string, unknown>)[key])]),
  );
}

function dataOf(
  source: SourceDocument,
  document: 'portfolio' | 'site',
): { data: unknown; version: number } {
  const format: DocumentFormat = source.format === 'json' ? 'json' : 'yaml';
  const parsed = parseSource(source.text, format);
  if (!parsed.ok) throw new Error(`The ${document} source doesn't parse, so it can't be exported.`);
  const version = (parsed.data as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version !== 'number') {
    throw new Error(`The ${document} source has no schemaVersion, so it can't be exported.`);
  }
  return { data: parsed.data, version };
}
