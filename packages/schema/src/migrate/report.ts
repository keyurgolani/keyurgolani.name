import { MIGRATE_COMMAND, shellQuote } from '../legacy';
import { SECRET_LABELS } from '../secrets';
import { unifiedDiff } from './diff';
import type { AssignedId } from './section-ids';
import type { Change, Migration, MigrationPlan, SecretSpot, Target } from './types';

// The dry run's text: what `pnpm config:migrate` prints. With `summary`, it
// leaves out every value the documents hold (ids made from titles, the old
// values, the origin, the diff, and the site document) so #18's homelab
// migration can log it. It does the same, whatever `summary` says, while the
// old file holds secret-shaped text: a line-by-line redaction can't hide a
// PEM key's body, or a token folded across lines.

export interface FormatOptions {
  /** The old file, as the owner gave it, relative to where they ran the command. */
  readonly file: string;
  readonly summary?: boolean;
}

export function formatMigration(migration: Migration, options: FormatOptions): string {
  const { file } = options;
  switch (migration.status) {
    case 'current':
      return `${file} is already a schemaVersion 2 ${migration.document} document. Nothing to migrate.\n`;
    case 'failed': {
      const reasons = options.summary
        ? (migration.summary ?? migration.reasons)
        : migration.reasons;
      return `${file} can't be migrated.\n${reasons.map((reason) => `  ${reason}\n`).join('')}`;
    }
    default:
      return formatPlan(migration, options);
  }
}

function formatPlan(plan: MigrationPlan, options: FormatOptions): string {
  const { file } = options;
  const withheld = plan.secrets.length > 0;
  const summary = (options.summary ?? false) || withheld;
  const extension = plan.format === 'json' ? 'json' : 'yml';
  // A site section key is an id, which a summary leaves out like any value.
  const masked = (document: Target['document'], pointer: string) =>
    summary && document === 'site'
      ? pointer.replace(/^\/sections\/[^/]+/, '/sections/<its id>')
      : pointer;
  const where = ({ document, pointer }: Target) =>
    `${document}.${extension} ${masked(document, pointer) || '/'}`;
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
    'Secret-shaped text, which no document may hold. Remove it from the file, revoke it, and run this again:',
    plan.secrets.map(secretLine),
  );
  block(
    'Moved:',
    [...by('moved'), ...by('mapped')].map((change) =>
      sentence(`${change.from} to ${where(change.to!)}`, change.note),
    ),
  );
  block(
    'Removed:',
    by('removed').flatMap((change) => [
      sentence(change.from!, change.note),
      // On a line of its own and with no period, so it copies cleanly.
      ...(!summary && change.value
        ? [`  ${change.value} (from meta.url; set PORTFOLIO_ORIGIN to the real public origin)`]
        : []),
    ]),
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
    plan.needs.length > 0
      ? 'Diagnostics in the new documents, checked with placeholders for the values still needed:'
      : 'Diagnostics in the new documents:',
    plan.diagnostics.map(
      (d) =>
        `${d.severity} ${d.code} ${d.document}.${extension} ${masked(d.document, d.pointer) || '/'}${d.line === undefined ? '' : `, line ${d.line}, column ${d.column}`}. ${d.message} ${d.remediation.split('\n')[0]}`,
    ),
  );
  if (plan.notChecked.length > 0) {
    const links = plan.notChecked.some((entry) => entry.startsWith('origin.'));
    out.push(
      '',
      `Not checked: ${plan.notChecked.join(', ')}.${links ? " Pass --origin <url> with the site's real public origin to check its links against it." : ''}`,
    );
  }

  out.push(
    '',
    plan.status === 'ready'
      ? `Nothing stops the migration. ${command(file, plan, summary)} --write --out <dir> writes both documents into <dir>.`
      : "The migration can't write until the values above are given and the problems fixed. It changed nothing.",
  );

  if (withheld) {
    out.push(
      '',
      "The diff and both documents aren't shown, and neither is any value above, while the file holds secret-shaped text.",
    );
  } else if (!summary) {
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

/** Where a secret is, and what it looks like, never what it is. */
function secretLine({ kind, in: at, pointer, path, line, column }: SecretSpot): string {
  const position = line === undefined ? '' : ` (line ${line}, column ${column})`;
  const what = SECRET_LABELS[kind];
  switch (at) {
    case 'value':
      return `${pointer || '/'}${position}: ${what}.`;
    case 'key':
      return `A key in ${pointer || '/'}${position}: ${what}.`;
    case 'comment':
      return `The comment on line ${line}: ${what}.`;
    case 'set':
      return `The --set value for ${path}: ${what}.`;
  }
}

function idLine({ index, id, source, anchor }: AssignedId, summary: boolean): string[] {
  const at = `/sections/${index}`;
  const is = summary ? `${at} gets an id` : `${at} is ${id}`;
  const renamed = summary ? `${at}/id is renamed` : `${at}/id becomes ${id}`;
  // The links visitors followed point at the old anchor.
  const was =
    id === anchor
      ? ''
      : summary
        ? ' Its anchor on the old page differs.'
        : ` The old page's anchor for it was #${anchor}.`;
  switch (source) {
    case 'kept':
      return was ? [`${at} keeps ${summary ? 'its id' : id}.${was}`] : [];
    case 'set':
      return [`${is}, from --set.${was}`];
    case 'hero':
      return [`${is}, as every hero is.${was}`];
    case 'title':
      return [`${is}, from its title.${was}`];
    case 'kind':
      return [
        `${is}, from its kind.${was} If links point at the id the old site showed for this untitled section, keep that one with --set portfolio.sections.${index}.id=<id>.`,
      ];
    case 'unusable':
      return [`${is}, from its kind: its title has no letter or digit an id can use.${was}`];
    case 'slugified':
      return [
        `${renamed}: ids are lowercase words and digits joined by hyphens, at most 64 characters.${was}`,
      ];
    case 'repeated':
      return [`${renamed}: an earlier section has that id.${was}`];
    case 'reserved':
      return [`${renamed}: every variant uses main for its <main> element.${was}`];
  }
}

/**
 * The command that writes, with the `--set` arguments the plan used and each
 * word quoted for the shell. A summary leaves their values out, and the ids
 * in their paths too.
 */
function command(file: string, plan: MigrationPlan, summary: boolean): string {
  const words = [MIGRATE_COMMAND, shellQuote(file)];
  for (const { to, value } of plan.changes.filter(({ code }) => code === 'set')) {
    const segments = to!.pointer
      .split('/')
      .slice(1)
      .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (summary && to!.document === 'site' && segments[0] === 'sections') segments[1] = '<its id>';
    const path = [to!.document, ...segments].join('.');
    words.push('--set', summary ? `${path}=<value>` : shellQuote(`${path}=${value}`));
  }
  if (plan.dropUnknown && plan.unknown.length > 0) words.push('--drop-unknown');
  return words.join(' ');
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
