import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultTuple, type Cell } from '../cells';
import { writeCellFailures } from './failure-records';
import { PREFERENCE_ROWS, VIEWPORTS } from './matrix';
import {
  axeFailures,
  colorPropertyFor,
  runnerFailure,
  type AxeResults,
  type CellContext,
} from './records';
import { HARNESS_SERVER, planServers, serverId, serverLabel, serverTag } from './server';

const CELL: Cell = {
  id: 'composition:fallback complete / fallback/platform-neutral/warm-parchment/humanist-ui/system',
  kind: 'composition',
  target: 'fallback',
  owner: '#5',
  profile: 'read-only',
  performanceTier: 'light',
  tuple: defaultTuple('fallback', 'system'),
  path: '/',
  route: '/',
  state: 'complete',
  expectedStatus: 200,
  source: 'complete',
  sentinel: true,
  fixture: false,
};

const CONTEXT: CellContext = {
  cell: CELL,
  viewport: VIEWPORTS.find((each) => each.id === '390x844')!,
  row: PREFERENCE_ROWS[0]!,
  artifacts: ['quality/results/cell/axe.json'],
};

/** Two violations, one on two elements, as axe reports them. */
const RESULTS = {
  violations: [
    {
      id: 'target-size',
      help: 'All touch targets must be 24px large, or leave sufficient space',
      description: 'Ensure touch targets have sufficient size and space',
      nodes: [
        {
          target: ['a[href$="#thesis"]'],
          any: [{ data: {} }],
          failureSummary:
            'Fix any of the following:\n  Target has insufficient size (78.9px by 18px, should be at least 24px by 24px)',
        },
        {
          target: ['a[href$="#gallery"]'],
          any: [],
          failureSummary: 'Fix any of the following:\n  Target has insufficient size',
        },
      ],
    },
    {
      id: 'color-contrast',
      help: 'Elements must meet minimum color contrast ratio thresholds',
      description: 'Ensure the contrast between foreground and background colors meets WCAG 2 AA',
      nodes: [
        {
          target: ['p.muted'],
          any: [{ data: { contrastRatio: 3.2, expectedContrastRatio: '4.5:1' } }],
        },
      ],
    },
  ],
} as unknown as Pick<AxeResults, 'violations'>;

const DETAILS = {
  'target-size': [
    { found: true, semanticRole: 'link', accessibleName: 'Thesis title' },
    { found: true, semanticRole: 'link', accessibleName: 'Gallery title' },
  ],
  'color-contrast': [
    { found: true, semanticRole: 'paragraph', tokenRole: 'text-muted', uiSlot: 'surface' },
  ],
};

test('one failure per failing rule and element, naming the cell, the input mode, the row, the tuple, and the element', () => {
  const failures = axeFailures(CONTEXT, RESULTS, DETAILS);
  assert.equal(failures.length, 3);
  assert.deepEqual(failures[0], {
    surface: 'fallback',
    composition: true,
    route: '/',
    tuple: {
      designLanguage: 'platform-neutral',
      colorScheme: 'warm-parchment',
      typography: 'humanist-ui',
      displayMode: 'system',
    },
    viewport: '390x844',
    inputMode: 'touch',
    preferenceMode: 'default',
    profile: 'read-only',
    artifacts: ['quality/results/cell/axe.json'],
    check: 'axe',
    rule: 'target-size',
    element: {
      semanticRole: 'link',
      accessibleName: 'Thesis title',
      uiSlot: undefined,
      tokenRole: undefined,
      selector: 'a[href$="#thesis"]',
    },
    expected: 'All touch targets must be 24px large, or leave sufficient space',
    actual: 'Target has insufficient size (78.9px by 18px, should be at least 24px by 24px)',
  });
  assert.equal(failures[1]?.element?.accessibleName, 'Gallery title');
  assert.equal(failures[2]?.rule, 'color-contrast');
  assert.equal(failures[2]?.element?.tokenRole, 'text-muted');
  assert.equal(failures[2]?.expected, '4.5:1');
  assert.equal(failures[2]?.actual, '3.2:1');
});

test("a token role is matched only for a rule that's about color", () => {
  assert.equal(colorPropertyFor('color-contrast'), 'color');
  assert.equal(colorPropertyFor('color-contrast-enhanced'), 'color');
  assert.equal(colorPropertyFor('link-in-text-block'), 'color');
  assert.equal(colorPropertyFor('target-size'), null);
  assert.equal(colorPropertyFor('image-alt'), null);
});

test("each failure goes through Part A's writer: valid 1.1 records, one file per rule and element", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-records-'));
  try {
    const failures = [
      ...axeFailures(CONTEXT, RESULTS, DETAILS),
      runnerFailure(CONTEXT, 'fixture-marker', '<html> has no data-quality-fixture'),
    ];
    const { written, duplicates } = await writeCellFailures(failures, {
      gate: {
        gate: 'quality-pr',
        reproCommand: 'pnpm ci:quality-pr tests/quality/cells.spec.ts:35',
      },
      dir,
    });
    assert.equal(written.length, 4);
    assert.equal(duplicates, 0);
    assert.equal(readdirSync(dir).length, 4);
    const records = written.map(
      (file) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>,
    );
    const marker = records.find((record) => record.rule === 'fixture-marker')!;
    assert.equal(marker.schemaVersion, '1.1');
    assert.equal(marker.gate, 'quality-pr');
    assert.equal(marker.test, 'runner on fallback');
    assert.equal(marker.variant, 'fallback');
    assert.equal(marker.inputMode, 'touch');
    assert.equal(marker.preferenceMode, 'default');
    assert.equal(marker.tuple, 'platform-neutral/warm-parchment/humanist-ui/system');
    assert.equal(marker.reproCommand, 'pnpm ci:quality-pr tests/quality/cells.spec.ts:35');
    const contrast = records.find((record) => record.rule === 'color-contrast')!;
    assert.equal(contrast.tokenRole, 'text-muted');
    assert.equal(contrast.semanticRole, 'paragraph');
    assert.equal(contrast.uiSlot, 'surface');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a server's id is stable, names its project, and tags only its own cells' tests", () => {
  assert.equal(
    serverLabel(HARNESS_SERVER),
    'read-only complete fallback/platform-neutral/warm-parchment/humanist-ui/system',
  );
  assert.match(serverId(HARNESS_SERVER), /^[0-9a-f]{10}$/);
  assert.equal(serverId(HARNESS_SERVER), serverId({ ...HARNESS_SERVER }));
  assert.notEqual(serverId(HARNESS_SERVER), serverId({ ...HARNESS_SERVER, profile: 'owner' }));
  assert.equal(serverTag(HARNESS_SERVER), `@server-${serverId(HARNESS_SERVER)}`);
  const other: Cell = { ...CELL, state: 'sparse', source: 'sparse' };
  const servers = planServers({
    tests: [
      { cell: CELL, viewport: CONTEXT.viewport, row: CONTEXT.row, engineSkips: {} },
      { cell: CELL, viewport: VIEWPORTS[0]!, row: CONTEXT.row, engineSkips: {} },
      { cell: other, viewport: VIEWPORTS[0]!, row: CONTEXT.row, engineSkips: {} },
    ],
  });
  assert.equal(servers.length, 2, 'one per server, however many tests share it');
  assert.deepEqual(
    servers.map((each) => each.id),
    [...servers.map((each) => each.id)].sort(),
  );
});
