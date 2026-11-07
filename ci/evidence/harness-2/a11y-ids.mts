// The ids of A11Y_CASES (the a11y and motion meta cases) in the tree it runs from, one per line (imports only).
const { A11Y_CASES } = await import(`${process.cwd()}/tests/quality/meta/a11y-cases.ts`);
for (const each of A11Y_CASES as { id: string; browser?: boolean }[]) console.log(`${each.id}${each.browser ? '' : ' (no browser)'}`);
