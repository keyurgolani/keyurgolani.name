// Row 65: run the named quality:meta cases from the tree it runs in, judged as quality:meta judges them
// (tests/quality/meta/cases.ts's judge). One "ok <id>" or "NOT OK <id>: <miss>" line each, then a count.
//   tsx meta-select.mts <id>...
const { judge, META_CASES } = await import(`${process.cwd()}/tests/quality/meta/cases.ts`);
const ids = process.argv.slice(2);
const cases = META_CASES.filter((each: { id: string }) => ids.includes(each.id));
let bad = 0;
for (const metaCase of cases) {
  let outcome;
  try {
    outcome = await metaCase.run();
  } catch (error) {
    outcome = { passed: false, findings: [`it threw: ${(error as Error).message}`] };
  }
  const miss = judge(metaCase, outcome);
  if (miss) bad += 1;
  console.log(miss ? `NOT OK ${metaCase.id}: ${miss}` : `ok ${metaCase.id}`);
}
console.log(`selected ${cases.length} of ${ids.length} asked; ${bad} NOT OK`);
