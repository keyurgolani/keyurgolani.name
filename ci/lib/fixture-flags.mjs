// The test fixtures' build-time flags (#19, Slice 3), such as
// APPEARANCE_FIXTURES: every flag apps/web/scripts/fixture-gate.ts maps has
// this shape, which that file's test holds it to, so a run that must build
// with no fixture can clear them all, as ci/test-profiles.mjs does.
export const FIXTURE_FLAG = /^[A-Z][A-Z0-9_]*_FIXTURES$/;

/**
 * The values of BUDGET_FIXTURES that admit #6's budget fixtures, as
 * apps/web/scripts/fixture-gate.ts's rows read them: `1` for the traced
 * variants and font, `over` for the one over its budget. Any other value,
 * `0` and the empty string among them, admits none, so a build with one is a
 * build without the flag. fixture-gate.test.ts holds the rows to this list.
 */
export const BUDGET_FIXTURE_VALUES = Object.freeze(['1', 'over']);

/**
 * Whether `env` builds with #6's budget fixtures.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function budgetFixtures(env) {
  return BUDGET_FIXTURE_VALUES.includes(env.BUDGET_FIXTURES ?? '');
}
