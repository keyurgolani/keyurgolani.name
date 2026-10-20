import { MIGRATE_COMMAND } from '../legacy';
import { unifiedDiff } from './diff';
import type { AssignedId } from './section-ids';
import type { Change, Migration, MigrationPlan, Target } from './types';

// The dry run's text: what `pnpm config:migrate` prints. With `summary`, it
// leaves out every value the documents hold (ids made from titles, the old
// values, the origin, the diff, and the site document) so #18's homelab
// migration can log it.

export interface FormatOptions {
  /** The old file's name, as the owner gave it. */
  readonly file: string;
  readonly summary?: boolean;
}

export function formatMigration(migration: Migration, options: FormatOptions): string {
  const { file } = options;
  switch (migration.status) {
    case 'current':
      return `${file} is already a schemaVersion 2 ${migration.document} document. Nothing to migrate.\n`;
    case 'failed':
      return `${file} can't be migrated.\n${migration.reasons.map((reason) => `  ${reason}\n`).join('')}`;
    default:
      return formatPlan(migration, options);
  }
}

function formatPlan(plan: MigrationPlan, { file, summary = false }: FormatOptions): string {
  const extension = plan.format === 'json' ? 'json' : 'yml';
  // A site section key is an id, which a summary leaves out like any value.
  const where = ({ document, pointer }: Target) =>
    `${document}.${extension} ${summary && document === 'site' ? pointer.replace(/^\/sections\/[^/]+/, '/sections/<its id>') : pointer || '/'}`;
  const valued = (text: string, value: string | undefined) =>
    summary || value === undefined ? text : `${text}: ${value}`;
  const out: string[] = [
    `${file} is in the old one-file format (version ${plan.from}). Migrating it writes portfolio.${extension} and site.${extension} at schemaVersion ${plan.to}.`,
  ];
  const block = (title: string, lines: readonly string[]) => {
    if (lines.length > 0) out.push('', title, ...lines.map((line) => `  ${line}`));
  };
  const by = (code: Change['code']) => plan.changes.filter((change) => change.code === code);

  block(
    'Moved:',
    [...by('moved'), ...by('mapped')].map((change) =>
      sentence(`${change.from} to ${where(change.to!)}`, change.note),
    ),
  );
  block(
    'Removed:',
    by('removed').map((change) =>
      sentence(
        change.from!,
        change.note,
        !summary && change.value ? `Proposed PORTFOLIO_ORIGIN: ${change.value}.` : undefined,
      ),
    ),
  );
  block(
    'Filled in, where the old file had nothing:',
    by('default').map((change) => sentence(valued(where(change.to!), change.value), change.note)),
  );
  block(
    'Section ids:',
    plan.ids.flatMap((assigned) => idLine(assigned, summary)),
  );
  block(
    'Set with --set:',
    by('set').map((change) => valued(where(change.to!), change.value)),
  );
  block(
    'Dropped with --drop-unknown, as the old schema dropped them:',
    by('dropped').map((change) => change.from!),
  );
  block(
    'Needs a value, given with --set:',
    plan.needs.map((need) => {
      const was = !summary && need.was !== undefined ? ` It was ${need.was}.` : '';
      const accepts = need.accepts ? `, one of: ${need.accepts.join(', ')}` : '';
      return `${need.path}. ${need.reason}${was} Pass --set ${need.path}=<value>${accepts}.`;
    }),
  );
  if (!plan.dropUnknown) {
    block(
      'Unknown keys. The old schema dropped them when it read the file, and this release refuses them, so pass --drop-unknown to drop them here too, or remove them from the file:',
      plan.unknown.map(
        ({ pointer, line, column }) =>
          `${pointer}${line === undefined ? '' : ` (line ${line}, column ${column})`}`,
      ),
    );
  }
  if (plan.comments.length > 0) {
    out.push(
      '',
      `The new documents don't keep the old file's comments, on lines ${list(plan.comments.map(String))}.`,
    );
  }
  block(
    'Diagnostics in the new documents:',
    plan.diagnostics.map(
      (d) =>
        `${d.severity} ${d.code} ${d.document}.${extension} ${d.pointer || '/'}${d.line === undefined ? '' : `, line ${d.line}, column ${d.column}`}. ${d.message} ${d.remediation.split('\n')[0]}`,
    ),
  );

  out.push(
    '',
    plan.status === 'ready'
      ? `Nothing stops the migration. ${MIGRATE_COMMAND} ${file}${setArguments(plan, summary)} --write --out <dir> writes both documents into <dir>.`
      : "The migration can't write until the values above are given and the problems fixed. It changed nothing.",
  );

  if (!summary) {
    const diff = unifiedDiff(plan.source, plan.portfolio.text, {
      before: `${file} (old)`,
      after: `portfolio.${extension} (new)`,
    });
    out.push(
      '',
      diff === null
        ? `portfolio.${extension}, which differs from ${file} on too many lines to show as a diff:\n${plan.portfolio.text}`
        : `portfolio.${extension}, as a diff from ${file}:\n${diff}`,
      `site.${extension}:\n${plan.site.text}`,
    );
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function idLine({ index, id, source }: AssignedId, summary: boolean): string[] {
  const at = `/sections/${index}`;
  const is = summary ? `${at} gets an id` : `${at} is ${id}`;
  switch (source) {
    case 'kept':
      return [];
    case 'set':
      return [`${is}, from --set.`];
    case 'hero':
      return [`${is}, as every hero is.`];
    case 'title':
      return [`${is}, from its title.`];
    case 'kind':
      return [
        `${is}, from its kind. If links point at the id the old site showed for this untitled section, keep that one with --set portfolio.sections.${index}.id=<id>.`,
      ];
    case 'slugified':
      return [
        `${summary ? `${at}/id is renamed` : `${at}/id becomes ${id}`}: ids are lowercase words and digits joined by hyphens, at most 64 characters.`,
      ];
    case 'repeated':
      return [
        `${summary ? `${at}/id is renamed` : `${at}/id becomes ${id}`}: an earlier section has that id.`,
      ];
    case 'reserved':
      return [
        `${summary ? `${at}/id is renamed` : `${at}/id becomes ${id}`}: every variant uses main for its <main> element.`,
      ];
  }
}

/** The `--set` arguments the plan used, so the printed command repeats them; a summary leaves their values out. */
function setArguments(plan: MigrationPlan, summary: boolean): string {
  const sets = plan.changes.filter(({ code }) => code === 'set');
  const values = sets.map(({ to, value }) => {
    const path = `${to!.document}${to!.pointer.replace(/\//g, '.').replace(/~1/g, '/').replace(/~0/g, '~')}`;
    return ` --set ${path}=${summary ? '<value>' : value}`;
  });
  return `${values.join('')}${plan.dropUnknown && plan.unknown.length > 0 ? ' --drop-unknown' : ''}`;
}

function sentence(...parts: (string | undefined)[]): string {
  return parts
    .filter((part): part is string => part !== undefined && part !== '')
    .map((part) => (/[.:]$/.test(part) ? part : `${part}.`))
    .join(' ');
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}
