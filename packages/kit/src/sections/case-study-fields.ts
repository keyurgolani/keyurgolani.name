// A case study's parts, by their key and fixed English label, in the order
// the shared case study shows them (#10, slice 1, item 7): the fields before
// the decisions, the decisions, the evidence, and the fields after it. The
// shared CaseStudy and caseStudyOutline() both read this one list.

export const CASE_STUDY_FIELDS = [
  ['challenge', 'Challenge'],
  ['context', 'Context'],
  ['role', 'Role'],
  ['constraints', 'Constraints'],
  ['decisions', 'Decisions'],
  ['evidence', 'Evidence'],
  ['outcomes', 'Outcomes'],
  ['reflection', 'Reflection'],
] as const;

export type CaseStudyField = (typeof CASE_STUDY_FIELDS)[number][0];

/** A field that's one Markdown text, which the shared case study shows under its label. */
export type CaseStudyTextField = Exclude<CaseStudyField, 'decisions' | 'evidence'>;

const isText = (
  field: (typeof CASE_STUDY_FIELDS)[number],
): field is Extract<(typeof CASE_STUDY_FIELDS)[number], readonly [CaseStudyTextField, string]> =>
  field[0] !== 'decisions' && field[0] !== 'evidence';

/** The text fields shown before the decisions, in order. */
export const FIELDS_BEFORE = CASE_STUDY_FIELDS.slice(
  0,
  CASE_STUDY_FIELDS.findIndex(([key]) => key === 'decisions'),
).filter(isText);

/** The text fields shown after the evidence, in order. */
export const FIELDS_AFTER = CASE_STUDY_FIELDS.slice(
  CASE_STUDY_FIELDS.findIndex(([key]) => key === 'evidence') + 1,
).filter(isText);
