import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AXES,
  describeSharedDivider,
  dividerKey,
  enforcementFailures,
  judgePair,
  sharedDividers,
  type PackRuling,
  type PackThresholds,
  type RuledVerdict,
} from './pack-distinct';

// D-1 (lead A, 2026-10-31): platform-neutral and material-3-inspired drew one
// divider, so Editorial Evidence's open index rendered the same in both. The
// guard's token score counts the divider, but tokens never vote, so the
// divider-distinct check holds it: a design-language pair the guard finds
// alike on its scored composition, failing or ruled, must not also draw one
// border-divider.

interface AxisJson {
  readonly enforced: boolean;
  readonly thresholds: PackThresholds;
  readonly rulings?: readonly PackRuling[];
}
const LANGUAGE: AxisJson = JSON.parse(
  readFileSync(new URL(`./${AXES.designLanguage.file}`, import.meta.url), 'utf8'),
);

/** A design-language row with edges `px` at `viewport`, tokens well apart. */
const row = (a: string, b: string, viewport: 'desktop' | 'mobile', px: number) =>
  judgePair({ a, b, viewport, px, token: 0.5 }, LANGUAGE.thresholds);
const ALIKE = { desktop: 0.05, mobile: 0.1 };
const APART = { desktop: 0.5, mobile: 0.9 };

const DIVIDERS: Readonly<Record<string, string>> = {
  quiet: '1px solid var(--color-border-subtle)',
  'quiet-twin': '1px  solid   VAR(--color-border-subtle) ',
  tonal: '1px solid color-mix(in srgb, var(--color-accent) 24%, var(--color-border-subtle))',
  bold: '3px double var(--color-accent)',
};
const dividerOf = (id: string) => DIVIDERS[id];

test('an alike pair that draws one divider is reported, with where it renders alike', () => {
  const outcomes = [
    row('quiet', 'quiet-twin', 'desktop', ALIKE.desktop),
    row('quiet', 'quiet-twin', 'mobile', ALIKE.mobile),
  ];
  assert.ok(outcomes.every((outcome) => outcome.fail));
  assert.deepEqual(sharedDividers(outcomes, dividerOf), [
    {
      pair: ['quiet', 'quiet-twin'],
      divider: '1px solid var(--color-border-subtle)',
      viewports: ['desktop', 'mobile'],
    },
  ]);
});

test('a pair alike at one viewport only is reported at that viewport', () => {
  const outcomes = [
    row('quiet-twin', 'quiet', 'desktop', APART.desktop),
    row('quiet-twin', 'quiet', 'mobile', ALIKE.mobile),
  ];
  const [shared] = sharedDividers(outcomes, dividerOf);
  assert.deepEqual(shared?.pair, ['quiet', 'quiet-twin']);
  assert.deepEqual(shared?.viewports, ['mobile']);
  assert.match(
    describeSharedDivider(shared!),
    /^quiet and quiet-twin render alike at mobile and draw one divider, 1px solid var\(--color-border-subtle\)/,
  );
});

test('a pair that passes everywhere may share a divider', () => {
  const outcomes = [
    row('quiet', 'quiet-twin', 'desktop', APART.desktop),
    row('quiet', 'quiet-twin', 'mobile', APART.mobile),
  ];
  assert.ok(outcomes.every((outcome) => !outcome.fail));
  assert.deepEqual(sharedDividers(outcomes, dividerOf), []);
});

test('an alike pair with two dividers passes, a tint of the same rule included', () => {
  const outcomes = [
    row('quiet', 'tonal', 'desktop', ALIKE.desktop),
    row('quiet', 'bold', 'mobile', ALIKE.mobile),
  ];
  assert.ok(outcomes.every((outcome) => outcome.fail));
  assert.deepEqual(sharedDividers(outcomes, dividerOf), []);
});

test('a pack with no divider to read is skipped, not matched', () => {
  const outcomes = [row('quiet', 'unknown', 'desktop', ALIKE.desktop)];
  assert.deepEqual(sharedDividers(outcomes, dividerOf), []);
});

test('dividerKey reads case and spacing away, and nothing else', () => {
  assert.equal(dividerKey(DIVIDERS['quiet-twin']!), dividerKey(DIVIDERS.quiet!));
  assert.equal(
    dividerKey('1px solid color-mix( in srgb, var(--color-accent) 24% , transparent )'),
    '1px solid color-mix(in srgb, var(--color-accent) 24%, transparent)',
  );
  assert.notEqual(dividerKey('1px solid'), dividerKey('2px solid'));
  assert.notEqual(dividerKey('1px solid'), dividerKey('1px dashed'));
});

test('a shared divider fails an enforced run and only reports otherwise', () => {
  const outcomes = [row('quiet', 'quiet-twin', 'desktop', ALIKE.desktop)];
  const shared = sharedDividers(outcomes, dividerOf);
  const none: RuledVerdict = {
    failures: [],
    ruled: [],
    unneeded: [],
    problems: [],
    refused: [],
    scopedApplied: 0,
  };
  assert.deepEqual(enforcementFailures({ enforced: false }, none, LANGUAGE.thresholds, shared), []);
  assert.deepEqual(enforcementFailures({ enforced: true }, none, LANGUAGE.thresholds, shared), [
    describeSharedDivider(shared[0]!),
  ]);
  assert.deepEqual(enforcementFailures({ enforced: true }, none, LANGUAGE.thresholds), []);
});

test('no pair the design-language rulings name draws one divider in the shipping packs', () => {
  const packs = new URL('../../packages/appearance-languages/packs/', import.meta.url);
  const divider = new Map(
    readdirSync(packs).map((id) => {
      const manifest = JSON.parse(readFileSync(new URL(`${id}/manifest.json`, packs), 'utf8')) as {
        tokens: Record<string, string>;
      };
      return [id, dividerKey(manifest.tokens['border-divider']!)];
    }),
  );
  const ruled = (LANGUAGE.rulings ?? []).flatMap(({ pairs }) => pairs);
  assert.ok(
    ruled.some(([a, b]) => [a, b].sort().join() === 'material-3-inspired,platform-neutral'),
    'material-3-inspired / platform-neutral is ruled (at 390)',
  );
  const shared = ruled
    .filter(([a, b]) => divider.has(a!) && divider.get(a!) === divider.get(b!))
    .map(([a, b]) => `${a} and ${b}: ${divider.get(a!)}`);
  assert.deepEqual(shared, []);
});
