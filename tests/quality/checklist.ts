// pnpm quality:checklist -- <surface> (#11, Slice 1, item 2): the manual
// pass's checklist for one registered surface or composition, from its
// routes, its state fixtures, its interactions, and its primary actions,
// with the 2.3.1 flash check, which no automated gate makes. It prints the
// checklist as Markdown and writes it to reports/quality/checklists/. Slice 5
// completes it: automated results flagged for review, the manual-run
// record's fields, and the docs.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { readBuildMeta, workRoutes } from './cells';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import {
  loadRegistrations,
  type Interaction,
  type Registrations,
  type SurfaceRegistration,
} from './lib/registration';
import { STATE_FIXTURES } from './lib/state-fixtures';

/** The checklist's version, which a manual-run record will name. */
export const CHECKLIST_VERSION = 1;

/** The flash check every checklist ends with (WCAG 2.3.1). */
export const FLASH_ITEM =
  'Nothing flashes more than three times in any one second, on any route, in any state, with motion on and off (WCAG 2.3.1).';

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

/** The checklist for `id`, a surface's id or a registered composition's, as Markdown. */
export function checklist(id: string, registrations: Registrations, web: string): string {
  const surface = registrations.surfaces.find((each) => each.id === id);
  let target: Target;
  if (surface) target = surfaceTarget(surface);
  else {
    const variant = readBuildMeta(web).VARIANTS.find(({ manifest }) => manifest.id === id);
    if (!variant) {
      const known = [
        ...registrations.surfaces.map((each) => each.id),
        ...readBuildMeta(web).VARIANTS.map(({ manifest }) => manifest.id),
      ];
      throw new Error(`Nothing registers ${id}. Registered: ${known.join(', ')}.`);
    }
    const unit = registrations.units.find((each) => each.id === id);
    target = {
      id,
      kind: 'composition',
      routes: ['/', ...workRoutes(contractFixture('complete'))],
      states: STATE_FIXTURES.map((state) => ({ id: state.id, query: '' })),
      interactions: unit?.interactions ?? [],
      primaryActions: unit?.primaryActions ?? [],
    };
  }
  const lines = [
    `# Manual checklist: ${target.id} (${target.kind})`,
    '',
    `Checklist version ${CHECKLIST_VERSION}. Record the browser, assistive technology, and OS with versions, the viewport, the commit, and each item's result.`,
    '',
    '## Routes and states',
    '',
    ...target.routes.flatMap((route) =>
      target.states.map(
        (state) =>
          `- [ ] ${route}${state.query ? `?${state.query}` : ''} (${state.id}): headings, landmarks, and every control's name and state read correctly, and the reading order matches the visual order.`,
      ),
    ),
    '',
    '## Interactions',
    '',
    ...(target.interactions.length > 0
      ? target.interactions.map((interaction) => `- [ ] ${interactionItem(interaction)}`)
      : [
          '- [ ] None registered: confirm the page has no dialog, disclosure, drag, or status change.',
        ]),
    '',
    '## Primary actions',
    '',
    ...(target.primaryActions.length > 0
      ? target.primaryActions.map(
          (name) =>
            `- [ ] "${name}" is at least 44x44 CSS px to touch, and works with a screen reader's activation.`,
        )
      : ['- [ ] None registered.']),
    '',
    '## Flashes',
    '',
    `- [ ] ${FLASH_ITEM}`,
    '',
  ];
  return lines.join('\n');
}

async function main(argv: readonly string[]): Promise<number> {
  const id = (argv[0] === '--' ? argv[1] : argv[0])?.trim();
  if (!id) {
    console.error('usage: pnpm quality:checklist -- <surface or composition id>');
    return 2;
  }
  const web = process.env.QUALITY_WEB ?? fileURLToPath(new URL('../../apps/web/', import.meta.url));
  let text: string;
  try {
    text = checklist(id, await loadRegistrations(), web);
  } catch (error) {
    console.error(`[checklist] ${(error as Error).message}`);
    return 1;
  }
  const dir = path.join(reportsDir(), 'quality', 'checklists');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.md`), text);
  process.stdout.write(text);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
