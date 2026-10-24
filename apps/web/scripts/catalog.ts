// `pnpm catalog <command>` (#20): the appearance catalog from the command
// line, read as build:registry reads it, writing nothing.
//
//   pnpm catalog search ['q=sage&axis=scheme&tier=stable']   entries a URL query matches, by axis and tier
//   pnpm catalog show <id>                                   one entry's tier, provenance, and status
//   pnpm catalog recipe [<id>]                               a recipe's axis ids, query, and diagnostics
//   pnpm catalog audit                                       the branded-name audit, entry by entry
//
// search takes the filters as a URL query: q (words), axis (language,
// scheme, or type), tier, status (shipping, excluded, held, or research),
// license, and mode (light or dark), and prints the query it read back in
// its one canonical form. Add --json for the entries as JSON.

import { AXIS_NAMES } from '@portfolio/appearance';
import { formatRegistryDiagnostics } from '@portfolio/variant-contract/node';
import { auditCatalog } from './catalog-audit';
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
import { readCatalogSources } from './catalog-sources';
import { REPO_ROOT } from './registry-options';

const USAGE = 'Usage: pnpm catalog search [<query>] [--json] | show <id> | recipe [<id>] | audit\n';
const TAG = '[catalog]';

async function main(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
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
      out(unavailable(read.registry, entries, operands[0]));
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
          ...formatRecipe(applyRecipe(read.registry, recipe)),
        ]),
      );
      return 0;
    }
    case 'audit': {
      const report = auditCatalog({
        packs: [
          ...read.packs.filter(({ fixture }) => !fixture),
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
