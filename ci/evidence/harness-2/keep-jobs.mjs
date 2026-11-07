// Harness push 2's evidence branch, never merged: the changes job's selection (SELECTED, its jobs
// output, through env alone) kept to the jobs this branch needs: quality-pr's three, planned as the
// selection plans them, quality-meta and unit. Every other check job is emptied, its specs untouched
// by the push or covered by the evidence jobs. Writes jobs= to GITHUB_OUTPUT and prints both lists.
import { appendFileSync } from 'node:fs';
const KEEP = ['unit', 'quality-pr-plan', 'quality-pr', 'quality-pr-verdict', 'quality-meta'];
const selected = JSON.parse(process.env.SELECTED ?? '');
if (!Array.isArray(selected) || !selected.every((job) => typeof job === 'string'))
  throw new Error('SELECTED is not a JSON list of job names');
const kept = selected.filter((job) => KEEP.includes(job));
const emptied = selected.filter((job) => !KEEP.includes(job));
console.log(`kept (${kept.length}): ${kept.join(', ')}`);
console.log(`emptied (${emptied.length}): ${emptied.join(', ')}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `jobs=${JSON.stringify(kept)}\n`);
