import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultTuple, type Cell } from '../cells';
import { cellFailureRecord, failureKey, writeCellFailures } from './failure-records';
import { PREFERENCE_ROWS, VIEWPORTS } from './matrix';
import {
  axeFailures,
  colorPropertyFor,
  nodeSelector,
  nodeTarget,
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
      target: undefined,
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
      runnerFailure(CONTEXT, 'status', '503, not 200'),
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
    const status = records.find((record) => record.rule === 'status')!;
    assert.equal(status.schemaVersion, '1.1');
    assert.equal(status.gate, 'quality-pr');
    assert.equal(status.test, 'runner on fallback');
    assert.equal(status.variant, 'fallback');
    assert.equal(status.inputMode, 'touch');
    assert.equal(status.preferenceMode, 'default');
    assert.equal(status.tuple, 'platform-neutral/warm-parchment/humanist-ui/system');
    assert.equal(status.actual, '503, not 200');
    assert.equal(status.reproCommand, 'pnpm ci:quality-pr tests/quality/cells.spec.ts:35');
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
      {
        cell: CELL,
        viewport: CONTEXT.viewport,
        row: CONTEXT.row,
        engineSkips: {},
        conditions: true,
      },
      { cell: CELL, viewport: VIEWPORTS[0]!, row: CONTEXT.row, engineSkips: {}, conditions: true },
      { cell: other, viewport: VIEWPORTS[0]!, row: CONTEXT.row, engineSkips: {}, conditions: true },
    ],
  });
  assert.equal(servers.length, 2, 'one per server, however many tests share it');
  assert.deepEqual(
    servers.map((each) => each.id),
    [...servers.map((each) => each.id)].sort(),
  );
});

test('nodeSelector names an element in the page by its one selector, and none inside a frame or a shadow root', () => {
  const node = (target: unknown[]) => ({ target }) as unknown as Parameters<typeof nodeSelector>[0];
  assert.equal(nodeSelector(node(['main p.muted'])), 'main p.muted');
  // A frame's: a part for each document, the frame's first. The last part names nothing in the page.
  assert.equal(nodeSelector(node(['iframe', '.ee-plate__label'])), null);
  // A shadow root's: its part is a list.
  assert.equal(nodeSelector(node([['x-card', 'p']])), null);
  assert.equal(nodeSelector(node([])), null);
});

test('a violation inside a frame or a shadow root keeps its target chain beside its null selector, for a reader alone: no key or written record reads it', () => {
  const node = (target: unknown[]) => ({ target }) as unknown as Parameters<typeof nodeTarget>[0];
  assert.equal(nodeTarget(node(['main p.muted'])), undefined);
  assert.equal(nodeTarget(node([])), undefined);
  assert.equal(nodeTarget(node(['iframe', '.inner'])), 'iframe >>> .inner');
  assert.equal(nodeTarget(node([['x-card', 'p']])), 'x-card >>> p');
  assert.equal(
    nodeTarget(node(['#preview', ['x-card', 'a.more']])),
    '#preview >>> x-card >>> a.more',
  );
  const violations = (target: unknown[]) =>
    ({
      violations: [
        {
          id: 'link-name',
          help: 'Links must have discernible text',
          description: 'Ensure links have discernible text',
          nodes: [{ target, any: [], failureSummary: 'Fix all of the following:\n  No text' }],
        },
      ],
    }) as unknown as Pick<AxeResults, 'violations'>;
  const details = { 'link-name': [{ found: false }] };
  const [framed] = axeFailures(CONTEXT, violations(['iframe', '.inner']), details);
  assert.equal(framed?.element?.selector, undefined);
  assert.equal(framed?.element?.target, 'iframe >>> .inner');
  const [page] = axeFailures(CONTEXT, violations(['main a']), details);
  assert.equal(page?.element?.selector, 'main a');
  assert.equal(page?.element?.target, undefined);
  // Display alone: two frame violations of one rule share a key whatever their chains,
  // and the written record has no field for it.
  const [other] = axeFailures(CONTEXT, violations(['iframe', '.other']), details);
  assert.equal(failureKey(framed!), failureKey(other!));
  const record = cellFailureRecord(framed!, {
    gate: 'quality-pr',
    reproCommand: 'pnpm quality:pr',
  });
  assert.ok(!JSON.stringify(record).includes('>>>'), JSON.stringify(record));
});
