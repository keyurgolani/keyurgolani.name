// Where data-script-only may go (the coordinator, 7 Nov 2026, inventory addendum F5). The mark
// lets words go without JavaScript, under failed enhancement and in print (lib/a11y/probe.ts's
// inventory), so it's for live status chrome whose words only live script sets, and nothing
// else. Nothing in the harness itself keeps it there: a marked live region a script fills with
// words it fetched goes unrecorded. So every file outside the harness, the docs and the tests
// that names the mark is listed here, with how many times it names it and why, and
// script-only-marks.test.ts fails a file that isn't, a count that changed, and an entry that
// names no mark any more.
//
// An entry is { file, marks, reason }: the file's path from the repository root; how many times
// the file's text holds "data-script-only" or writes `dataset.scriptOnly` (markCount), comments
// included; and a sentence saying what the marked element is and why its words are live script's
// alone. An entry covers every element its file renders with the mark, so a file whose one mark
// sits in a component rendered many times is one entry. For example:
//   {
//     file: 'packages/variant-horizontal-cinema/src/controller.tsx',
//     marks: 1,
//     reason: 'The scrubber\'s position status ("Opening, 1 of 21"), a role="status" that only the hydrated scrubber fills, since a static stand-in would be wrong wherever the reader is.',
//   },

/** One file that names the mark. */
export interface ScriptOnlyMark {
  /** The file, from the repository root. */
  readonly file: string;
  /** How many times its text holds the mark's name. */
  readonly marks: number;
  /** Why: what the marked element is, and why only live script sets its words, in a sentence. */
  readonly reason: string;
}

/** Every file outside the harness, the docs and the tests that names data-script-only. */
export const SCRIPT_ONLY_MARKS: readonly ScriptOnlyMark[] = [
  {
    file: 'packages/variant-spatial-bento/src/esc-hint.tsx',
    marks: 1,
    reason:
      "The case's Esc keyboard hint, which CaseFocus shows only once its Escape listener is attached; Back to the field does the same action.",
  },
];

/** The mark's name, as a file's text holds it. */
export const MARK = 'data-script-only';
/** The mark as a script writes it on an element's dataset, which names it as much. */
export const DATASET_MARK = 'dataset.scriptOnly';

/** How many times `text` names the mark: as an attribute, or as a dataset write. */
export const markCount = (text: string): number =>
  text.split(MARK).length - 1 + (text.split(DATASET_MARK).length - 1);

/** A file that may name the mark unlisted: the harness, the docs, and tests, which read it. */
export function markExempt(file: string): boolean {
  return (
    file.startsWith('tests/') ||
    file.startsWith('docs/') ||
    file.endsWith('.md') ||
    /\.test\.[cm]?[jt]sx?$/.test(file)
  );
}

/** What's wrong with `list` against `found`, each file's mark count: one line each. */
export function markProblems(
  found: ReadonlyMap<string, number>,
  list: readonly ScriptOnlyMark[],
): string[] {
  const problems: string[] = [];
  const listed = new Map(list.map((entry) => [entry.file, entry]));
  for (const entry of list) {
    if (list.filter((each) => each.file === entry.file).length > 1)
      problems.push(`${entry.file}: listed more than once`);
    if (!/^[A-Z"'(].*\S[.!?)"']$/s.test(entry.reason.trim()))
      problems.push(`${entry.file}: its reason isn't a sentence`);
    if (markExempt(entry.file)) problems.push(`${entry.file}: listed, though it needs no entry`);
  }
  for (const [file, marks] of found) {
    if (markExempt(file)) continue;
    const entry = listed.get(file);
    if (!entry) problems.push(`${file}: names ${MARK} ${marks} time(s), and isn't listed`);
    else if (entry.marks !== marks)
      problems.push(`${file}: names ${MARK} ${marks} time(s), and the list says ${entry.marks}`);
  }
  for (const entry of list) {
    if (!markExempt(entry.file) && !found.has(entry.file))
      problems.push(`${entry.file}: listed, and names no ${MARK}`);
  }
  return [...new Set(problems)];
}
