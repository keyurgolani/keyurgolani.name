// The test fixtures' build-time flags (#19, Slice 3), such as
// APPEARANCE_FIXTURES: every flag apps/web/scripts/fixture-gate.ts maps has
// this shape, which that file's test holds it to, so a run that must build
// with no fixture can clear them all, as ci/test-profiles.mjs does.
export const FIXTURE_FLAG = /^[A-Z][A-Z0-9_]*_FIXTURES$/;
