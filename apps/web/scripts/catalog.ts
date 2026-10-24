// `pnpm catalog <command>` (#20): the appearance catalog from the command
// line, read as build:registry reads it, writing nothing.
//
//   pnpm catalog search ['q=sage&axis=scheme&tier=stable']   entries a URL query matches, by axis and tier
//   pnpm catalog show <id>                                   one entry's tier, provenance, and status
//   pnpm catalog recipe [<id>]                               a recipe's axis ids, query, and diagnostics
//   pnpm catalog audit                                       the branded-name audit, entry by entry
//   pnpm catalog review [--out <dir>]                        the generated schemes' review pages (#20 PR 3)
//   pnpm catalog accept <id> --by <login>                    the owner's acceptance of an image-derived scheme
//
// show adds a generated scheme's reference record: its input, what it
// extracted, its anchors and moves, its report, and whether the owner has
// accepted it. review writes the pages the owner reads before accepting an
// image-derived scheme, under reports/catalog/review by default. accept is
// the owner's alone: it pins the scheme's current record in acceptance.json,
// which the owner commits.
//
// search takes the filters as a URL query: q (words), axis (language,
// scheme, or type), tier, status (shipping, excluded, held, or research),
// license, and mode (light or dark), and prints the query it read back in
// its one canonical form. Add --json for the entries as JSON.

import path from 'node:path';
import { AXIS_BY_KIND, AXIS_NAMES } from '@portfolio/appearance';
import { packPackages } from '@portfolio/appearance/node';
import { formatRegistryDiagnostics } from '@portfolio/variant-contract/node';
import { auditCatalog } from './catalog-audit';
import { acceptScheme, generatedLines, writeReview } from './catalog-review';
import {
  applyRecipe,
  catalogEntries,
  formatRecipe,
  formatResults,
  parseCatalogQuery,
  readRecipes,
  searchCatalog,
  serializeCatalogQuery,
  unavailable,
} from './catalog-query';
import { readCatalogSources, type ReadSources } from './catalog-sources';
import { REPO_ROOT } from './registry-options';

const USAGE =
  'Usage: pnpm catalog search [<query>] [--json] | show <id> | recipe [<id>] | audit | review [--out <dir>] | accept <id> --by <login>\n';
const TAG = '[catalog]';

/** The held packs' reasons, by axis and id, for a recipe's diagnostics. */
function heldReasons(read: ReadSources): Map<string, string> {
  return new Map(
    read.held.map(({ kind, manifest, reason }) => [`${AXIS_BY_KIND[kind]}:${manifest.id}`, reason]),
  );
}

async function main(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === 'accept') {
    if (rest.length !== 3 || rest[1] !== '--by') {
      process.stderr.write(USAGE);
      return 2;
    }
    const accepted = acceptScheme(REPO_ROOT, packPackages(REPO_ROOT), rest[0]!, rest[2]!);
    if (!accepted.ok) {
      process.stderr.write(`${TAG} ${accepted.problem}\n`);
      return 1;
    }
    process.stdout.write(`${TAG} Accepted ${rest[0]} in ${accepted.file}. Commit it.\n`);
    return 0;
  }
  if (command === 'review') {
    const out =
      rest.length === 2 && rest[0] === '--out' ? rest[1]! : rest.length === 0 ? null : undefined;
    if (out === undefined) {
      process.stderr.write(USAGE);
      return 2;
    }
    const written = writeReview(
      REPO_ROOT,
      packPackages(REPO_ROOT),
      path.resolve(out ?? path.join(REPO_ROOT, 'reports', 'catalog', 'review')),
    );
    process.stdout.write(`${TAG} Wrote ${written.length} review pages: ${written.join(', ')}\n`);
    return 0;
  }
  const json = rest.includes('--json');
  const operands = rest.filter((arg) => arg !== '--json');
  if (!command || operands.length > 1 || (json && command !== 'search')) {
    process.stderr.write(USAGE);
    return 2;
  }
  const loaded = await readCatalogSources(process.env);
  if (!loaded.ok) {
    process.stderr.write(formatRegistryDiagnostics(loaded.diagnostics));
    process.stderr.write(`${TAG} Registry generation failed, so nothing was read.\n`);
    return 1;
  }
  const read = loaded.sources;
  const entries = catalogEntries(read);
  const out = (lines: readonly string[]) => process.stdout.write(`${lines.join('\n')}\n`);

  switch (command) {
    case 'search': {
      const parsed = parseCatalogQuery(operands[0] ?? '');
      if (!parsed.ok) {
        process.stderr.write(`${TAG} ${parsed.problem}\n`);
        return 2;
      }
      const found = searchCatalog(entries, parsed.query);
      if (json) {
        out([
          JSON.stringify({ query: serializeCatalogQuery(parsed.query), entries: found }, null, 2),
        ]);
        return 0;
      }
      out([
        `${TAG} ${found.length} of ${entries.length} entries match ${serializeCatalogQuery(parsed.query) || 'everything'}.`,
        ...(found.length > 0 ? ['', ...formatResults(found)] : []),
      ]);
      return 0;
    }
    case 'show': {
      if (!operands[0]) break;
      out([
        ...unavailable(read.registry, entries, operands[0]),
        ...generatedLines(REPO_ROOT, packPackages(REPO_ROOT), operands[0]),
      ]);
      return 0;
    }
    case 'recipe': {
      const recipes = readRecipes(REPO_ROOT);
      const chosen = operands[0] ? recipes.filter(({ id }) => id === operands[0]) : recipes;
      if (chosen.length === 0) {
        process.stderr.write(
          `${TAG} ${operands[0]} isn't a recipe: ${recipes.map(({ id }) => id).join(', ')}.\n`,
        );
        return 2;
      }
      out(
        chosen.flatMap((recipe, index) => [
          ...(index > 0 ? [''] : []),
          ...formatRecipe(applyRecipe(read.registry, recipe, heldReasons(read))),
        ]),
      );
      return 0;
    }
    case 'audit': {
      const report = auditCatalog({
        packs: [
          ...read.packs
            .filter(({ fixture }) => !fixture)
            .map((pack) => {
              const text = pack.stylesheet ? read.stylesheets.get(pack.stylesheet.url) : undefined;
              return {
                kind: pack.kind,
                manifest: pack.manifest,
                ...(pack.kind === 'design-language' && text ? { stylesheetText: text } : {}),
              };
            }),
          ...(read.held ?? []).map(({ kind, manifest }) => ({ kind, manifest })),
        ],
        research: read.research.map(({ record }) => record),
      });
      out([
        `${TAG} ${report.entries.length} entries audited, ${report.findings.length} finding${report.findings.length === 1 ? '' : 's'}.`,
        '',
        ...report.entries.map(
          (entry) =>
            `${entry.id} (${AXIS_NAMES[entry.axis]}, ${entry.tier}): ${entry.status}${
              entry.license === entry.status ? '' : `, ${entry.license}`
            }${
              entry.names.length > 0 ? `; names ${entry.names.join(', ')}` : ''
            }${entry.references.length > 0 ? `; references ${entry.references.join(', ')}` : ''}${
              entry.notes.length > 0 ? `\n  ${entry.notes.join('\n  ')}` : ''
            }`,
        ),
        ...(report.findings.length > 0
          ? ['', ...report.findings.map(({ message }) => message)]
          : []),
      ]);
      return report.findings.length > 0 ? 1 : 0;
    }
  }
  process.stderr.write(USAGE);
  return 2;
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
