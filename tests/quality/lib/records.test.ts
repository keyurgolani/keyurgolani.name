import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultTuple, type Cell } from '../cells';
import { VIEWPORTS, PREFERENCE_ROWS } from './matrix';
import {
  axeRecords,
  colorPropertyFor,
  harnessRecord,
  RECORD_SCHEMA_VERSION,
  writeRecords,
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
  test: 'cells.spec.ts > fallback complete / at 390x844, default',
  artifacts: ['quality/results/cell/axe.json'],
};

/** Two violations, one with two elements, as axe reports them. */
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

test('one record per failing rule and element, naming the cell, the input mode, the row, the tuple, and the element', () => {
  const records = axeRecords(CONTEXT, RESULTS, {
    'target-size': [
      { found: true, semanticRole: 'link', accessibleName: 'Thesis title', uiSlot: undefined },
      { found: true, semanticRole: 'link', accessibleName: 'Gallery title' },
    ],
    'color-contrast': [
      { found: true, semanticRole: 'paragraph', tokenRole: 'text-muted', uiSlot: 'surface' },
    ],
  });
  assert.equal(records.length, 3);
  assert.deepEqual(records[0], {
    test: CONTEXT.test,
    rule: 'target-size',
    route: '/',
    profile: 'read-only',
    viewport: '390x844',
    inputMode: 'touch',
    preferenceMode: 'default',
    displayMode: 'system',
    tuple: 'fallback/platform-neutral/warm-parchment/humanist-ui/system',
    variant: 'fallback',
    pack: undefined,
    artifacts: ['quality/results/cell/axe.json'],
    uiSlot: undefined,
    semanticRole: 'link',
    accessibleName: 'Thesis title',
    tokenRole: undefined,
    expected: 'All touch targets must be 24px large, or leave sufficient space',
    actual: 'Target has insufficient size (78.9px by 18px, should be at least 24px by 24px)',
  });
  assert.equal(records[1]?.accessibleName, 'Gallery title');
  assert.equal(records[2]?.rule, 'color-contrast');
  assert.equal(records[2]?.tokenRole, 'text-muted');
  assert.equal(records[2]?.expected, '4.5:1');
  assert.equal(records[2]?.actual, '3.2:1');
});

test("a token role is matched only for a rule that's about color", () => {
  assert.equal(colorPropertyFor('color-contrast'), 'color');
  assert.equal(colorPropertyFor('color-contrast-enhanced'), 'color');
  assert.equal(colorPropertyFor('link-in-text-block'), 'color');
  assert.equal(colorPropertyFor('target-size'), null);
  assert.equal(colorPropertyFor('image-alt'), null);
});

test('records go into the failures directory one file each, in schema 1.1, with the gate and the command, and no empty field', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-records-'));
  try {
    const files = writeRecords(
      [harnessRecord(CONTEXT, 'fixture-marker', '<html> has no data-quality-fixture')],
      { gate: 'quality-pr', reproCommand: 'pnpm ci:quality-pr tests/quality/cells.spec.ts:35' },
      dir,
    );
    assert.equal(files.length, 1);
    assert.deepEqual(readdirSync(dir), [path.basename(files[0]!)]);
    const record = JSON.parse(readFileSync(files[0]!, 'utf8')) as Record<string, unknown>;
    assert.equal(record.schemaVersion, RECORD_SCHEMA_VERSION);
    assert.equal(record.gate, 'quality-pr');
    assert.equal(record.rule, 'fixture-marker');
    assert.equal(record.inputMode, 'touch');
    assert.equal(record.reproCommand, 'pnpm ci:quality-pr tests/quality/cells.spec.ts:35');
    assert.ok(!('pack' in record), 'an empty field stays out');
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
