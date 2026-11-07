// Harness push 2's follow-up evidence branch, never merged: the changes job's selection (SELECTED, its
// jobs output, through env alone) emptied, so the one evidence job (followup-evidence) runs alone and
// every check job is skipped. Writes jobs=[] to GITHUB_OUTPUT and prints what it emptied.
import { appendFileSync } from 'node:fs';
const selected = JSON.parse(process.env.SELECTED ?? '');
if (!Array.isArray(selected) || !selected.every((job) => typeof job === 'string'))
  throw new Error('SELECTED is not a JSON list of job names');
console.log(`kept (0)`);
console.log(`emptied (${selected.length}): ${selected.join(', ')}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'jobs=[]\n');
