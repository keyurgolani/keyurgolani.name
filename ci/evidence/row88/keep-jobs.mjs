// Batch S's evidence branch, never merged: the changes job's selection (SELECTED, its jobs output, through
// env alone) cut to the build job, which runs pnpm ci:studio-chunks (#9's split, which the emptied selection
// of #204 and #205 never checked), so build and row88-evidence run and every other check job is skipped.
// Writes jobs=["build"] to GITHUB_OUTPUT and prints what it kept and what it emptied.
import { appendFileSync } from 'node:fs';
const selected = JSON.parse(process.env.SELECTED ?? '');
if (!Array.isArray(selected) || !selected.every((job) => typeof job === 'string'))
  throw new Error('SELECTED is not a JSON list of job names');
const KEEP = ['build'];
const emptied = selected.filter((job) => !KEEP.includes(job));
console.log(`kept (${KEEP.length}): ${KEEP.join(', ')}${selected.includes('build') ? '' : ' (not in the selection: kept anyway)'}`);
console.log(`emptied (${emptied.length}): ${emptied.join(', ')}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `jobs=${JSON.stringify(KEEP)}\n`);
