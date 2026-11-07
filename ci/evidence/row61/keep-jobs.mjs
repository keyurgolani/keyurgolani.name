// Row 61's evidence branch, never merged (kgn-e/row61-ci): the changes job's selection (SELECTED, its
// jobs output, through env alone) kept to the jobs this branch needs: quality-pr's three, which plan
// as the selection has it, so the KC pack cells the [37] rule directs for a change to Kinetic
// Cosmos's styles run; and variants, Kinetic Cosmos's shots and mode checks on CI Linux. Every
// other check job is emptied. Writes jobs= to GITHUB_OUTPUT and prints both lists, and fails if a
// kept job isn't in the selection (the selection's rule, not this file, decides what a change runs).
import { appendFileSync } from 'node:fs';
const KEEP = ['quality-pr-plan', 'quality-pr', 'quality-pr-verdict', 'variants'];
const selected = JSON.parse(process.env.SELECTED ?? '');
if (!Array.isArray(selected) || !selected.every((job) => typeof job === 'string'))
  throw new Error('SELECTED is not a JSON list of job names');
const kept = selected.filter((job) => KEEP.includes(job));
const emptied = selected.filter((job) => !KEEP.includes(job));
console.log(`kept (${kept.length}): ${kept.join(', ')}`);
console.log(`emptied (${emptied.length}): ${emptied.join(', ')}`);
const missing = KEEP.filter((job) => !selected.includes(job));
if (missing.length)
  throw new Error(
    `the selection doesn't select ${missing.join(', ')}: this evidence would not run them`,
  );
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `jobs=${JSON.stringify(kept)}\n`);
