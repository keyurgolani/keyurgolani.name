import {
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
// source's data by #4's serialize(): keys in schema order (sorted inside
// extension data, authored order for anything else), two-space indent, LF
// line ends, and a trailing newline. It's pure and byte-deterministic: the
// same sources give the same bytes, whatever their own formatting or key
// order, and an exported pair imports to the same models in both formats.
// Each document states its schemaVersion, and `disclosure.schemaVersions`
// repeats them.
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
  return {
    files: [
      { name: `portfolio.${extension}`, text: serialize(portfolio.data, format) },
      { name: `site.${extension}`, text: serialize(site.data, format) },
    ],
    disclosure: {
      schemaVersions: { portfolio: portfolio.version, site: site.version },
      omitted: [...BROWSER_ONLY_OMISSIONS, ...(commented ? (['yaml-comments'] as const) : [])],
    },
  };
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
