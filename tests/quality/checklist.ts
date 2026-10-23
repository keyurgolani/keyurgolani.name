// pnpm quality:checklist -- <surface> [--record] (#11, original item 3): the
// manual pass's checklist for one registered surface or composition, from
// its routes, its state fixtures, its interactions, and its primary
// actions, with the 2.3.1 flash check, which no automated gate makes. Each
// item has an id, which a manual-run record answers by. It prints the
// checklist as Markdown and writes it to reports/quality/checklists/.
//
// With --record it prints a record to fill in instead: the YAML a manual
// run is kept as in quality/manual-runs/ (lib/manual-runs.ts), with every
// item, set up for the first pass, VoiceOver with Safari on macOS. The
// committed templates in quality/manual-runs/templates/ are its output.
// pnpm quality:meta validates every record against its surface's checklist.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { REPO_ROOT, reportsDir } from '../../ci/lib/reports.mjs';
import { readRegistry } from '../../packages/variant-contract/src/node/index';
import { workRoutes } from './cells';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import {
  loadRegistrations,
  type Interaction,
  type Registrations,
  type SurfaceRegistration,
} from './lib/registration';
import { STATE_FIXTURES } from './lib/state-fixtures';

/**
 * The checklist's version, which a manual-run record names. 2 gave every
 * item an id, which records answer by.
 */
export const CHECKLIST_VERSION = 2;

/** The flash check every checklist ends with (WCAG 2.3.1). */
export const FLASH_ITEM =
  'Nothing flashes more than three times in any one second, on any route, in any state, with motion on and off (WCAG 2.3.1).';

/** One thing to check, by an id a record answers it by. */
export interface ChecklistItem {
  readonly id: string;
  readonly section: 'Routes and states' | 'Interactions' | 'Primary actions' | 'Flashes';
  readonly text: string;
}

function interactionItem(interaction: Interaction): string {
  const where = `on ${interaction.route}`;
  switch (interaction.kind) {
    case 'dialog':
      return `Open "${interaction.name}" ${where} with the keyboard: focus moves into it, Escape closes it, and focus returns to "${interaction.name}".`;
    case 'disclosure':
      return `Toggle "${interaction.name}" ${where}: its expanded or pressed state is announced, and what it shows is reachable.`;
    case 'drag':
      return `Do what "${interaction.name}" does ${where} without dragging: ${interaction.alternative}`;
    case 'status':
      return `Use "${interaction.name}" ${where}: the live region announces it (${interaction.announces}), and focus stays where it was.`;
  }
}

interface Target {
  readonly id: string;
  readonly kind: 'surface' | 'composition';
  readonly routes: readonly string[];
  readonly states: readonly { readonly id: string; readonly query: string }[];
  readonly interactions: readonly Interaction[];
  readonly primaryActions: readonly string[];
}

function surfaceTarget(surface: SurfaceRegistration): Target {
  return {
    id: surface.id,
    kind: 'surface',
    routes: surface.routes,
    states: surface.stateFixtures.map((state) => ({
      id: state.id,
      query: new URLSearchParams(state.query).toString(),
    })),
    interactions: surface.interactions,
    primaryActions: surface.primaryActions,
  };
}

/** The registered surface or composition `id` names, or a throw naming what's registered. */
function targetFor(id: string, registrations: Registrations, compositions: readonly string[]) {
  const surface = registrations.surfaces.find((each) => each.id === id);
  if (surface) return surfaceTarget(surface);
  if (!compositions.includes(id)) {
    const known = [...registrations.surfaces.map((each) => each.id), ...compositions];
    throw new Error(`Nothing registers ${id}. Registered: ${known.join(', ')}.`);
  }
  const unit = registrations.units.find((each) => each.id === id);
  return {
    id,
    kind: 'composition',
    routes: ['/', ...workRoutes(contractFixture('complete'))],
    states: STATE_FIXTURES.map((state) => ({ id: state.id, query: '' })),
    interactions: unit?.interactions ?? [],
    primaryActions: unit?.primaryActions ?? [],
  } satisfies Target;
}

/** Every item of the checklist for `id`, a surface's id or a registered composition's. */
export function checklistItems(
  id: string,
  registrations: Registrations,
  compositions: readonly string[],
): ChecklistItem[] {
  const target = targetFor(id, registrations, compositions);
  return [
    ...target.routes.flatMap((route) =>
      target.states.map((state): ChecklistItem => ({
        id: `page:${route}:${state.id}`,
        section: 'Routes and states',
        text: `${route}${state.query ? `?${state.query}` : ''} (${state.id}): headings, landmarks, and every control's name and state read correctly, and the reading order matches the visual order.`,
      })),
    ),
    ...(target.interactions.length > 0
      ? target.interactions.map((interaction): ChecklistItem => ({
          id: `interaction:${interaction.kind}:${interaction.name}`,
          section: 'Interactions',
          text: interactionItem(interaction),
        }))
      : [
          {
            id: 'interaction:none',
            section: 'Interactions' as const,
            text: 'None registered: confirm the page has no dialog, disclosure, drag, or status change.',
          },
        ]),
    ...(target.primaryActions.length > 0
      ? target.primaryActions.map((name): ChecklistItem => ({
          id: `action:${name}`,
          section: 'Primary actions',
          text: `"${name}" is at least 44x44 CSS px to touch, and works with a screen reader's activation.`,
        }))
      : [{ id: 'action:none', section: 'Primary actions' as const, text: 'None registered.' }]),
    { id: 'flash', section: 'Flashes', text: FLASH_ITEM },
  ];
}

/** Where a surface's template for the first pass, VoiceOver with Safari on macOS, is kept. */
export const templateFile = (id: string) =>
  path.join(REPO_ROOT, 'quality', 'manual-runs', 'templates', `${id}.voiceover-safari-macos.yml`);

/** The checklist for `id`, a surface's id or a registered composition's, as Markdown. */
export function checklist(
  id: string,
  registrations: Registrations,
  compositions: readonly string[],
): string {
  const target = targetFor(id, registrations, compositions);
  const items = checklistItems(id, registrations, compositions);
  const sections = ['Routes and states', 'Interactions', 'Primary actions', 'Flashes'] as const;
  const lines = [
    `# Manual checklist: ${target.id} (${target.kind})`,
    '',
    `Checklist version ${CHECKLIST_VERSION}. Record the browser, assistive technology, and OS with versions, the viewport, the date, the tester, the commit, each item's result by its id, the run's result, and any exception it links.`,
    '',
  ];
  for (const section of sections) {
    lines.push(`## ${section}`, '');
    for (const item of items.filter((each) => each.section === section)) {
      lines.push(`- [ ] ${item.text} (\`${item.id}\`)`);
    }
    lines.push('');
  }
  lines.push(
    '## Record',
    '',
    `Copy \`quality/manual-runs/templates/${target.id}.voiceover-safari-macos.yml\`, or the output of \`pnpm quality:checklist -- ${target.id} --record\`, to \`quality/manual-runs/${target.id}-<date>-<browser>-<assistive technology>.yml\`, and fill in every \`todo\`: each item's result is pass, fail, or not-applicable, with a note for fail and not-applicable. \`pnpm quality:meta\` validates every record.`,
    '',
  );
  return lines.join('\n');
}

/** The record to fill in for `id`'s checklist: the first pass's, VoiceOver with Safari on macOS. */
export function recordTemplate(
  id: string,
  registrations: Registrations,
  compositions: readonly string[],
): string {
  const items = checklistItems(id, registrations, compositions);
  const header = [
    `# A manual run of the ${id} checklist (version ${CHECKLIST_VERSION}), set up for`,
    '# VoiceOver with Safari on macOS. Copy it to',
    `# quality/manual-runs/${id}-<date>-safari-voiceover.yml and replace every`,
    '# todo: the commit you tested (40 hex digits), the date (YYYY-MM-DD),',
    "# your GitHub handle, the versions, the run's result (pass or fail), and",
    "# each item's (pass, fail, or not-applicable, with a note for fail and",
    '# not-applicable). List any quality/exceptions.yml id the run links.',
    '# pnpm quality:meta validates it. Generated by',
    `# pnpm quality:checklist -- ${id} --record.`,
  ].join('\n');
  const record = {
    schemaVersion: 1,
    surface: id,
    checklistVersion: CHECKLIST_VERSION,
    commit: 'todo',
    date: 'todo',
    tester: 'todo',
    browser: { name: 'Safari', version: 'todo' },
    assistiveTechnology: { name: 'VoiceOver', version: 'todo' },
    os: { name: 'macOS', version: 'todo' },
    viewport: '1440x900',
    result: 'todo',
    exceptions: [],
    items: items.map((item) => ({ id: item.id, check: item.text, result: 'todo' })),
  };
  return `${header}\n${stringify(record, { lineWidth: 0 })}`;
}

/**
 * recordTemplate's YAML as Prettier formats it under the repository's
 * config, so what --record prints is committed and copied as it stands:
 * pnpm format:check finds nothing to change.
 */
export async function formattedRecordTemplate(
  id: string,
  registrations: Registrations,
  compositions: readonly string[],
): Promise<string> {
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(templateFile(id))) ?? {};
  return prettier.format(recordTemplate(id, registrations, compositions), {
    ...options,
    parser: 'yaml',
  });
}

/** The registered, non-fixture compositions of the checkout's host. */
export async function registeredCompositions(): Promise<string[]> {
  const registry = await readRegistry({ hostDir: path.join(REPO_ROOT, 'apps', 'web') });
  return registry.variants.map((variant) => variant.manifest.id);
}

async function main(argv: readonly string[]): Promise<number> {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const record = args.includes('--record');
  const id = args.filter((arg) => arg !== '--record')[0]?.trim();
  if (!id || args.length > (record ? 2 : 1)) {
    console.error('usage: pnpm quality:checklist -- <surface or composition id> [--record]');
    return 2;
  }
  let text: string;
  try {
    const registrations = await loadRegistrations();
    const compositions = await registeredCompositions();
    text = record
      ? await formattedRecordTemplate(id, registrations, compositions)
      : checklist(id, registrations, compositions);
  } catch (error) {
    console.error(`[checklist] ${(error as Error).message}`);
    return 1;
  }
  if (!record) {
    const dir = path.join(reportsDir(), 'quality', 'checklists');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${id}.md`), text);
  }
  process.stdout.write(text);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
