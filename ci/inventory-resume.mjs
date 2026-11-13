#!/usr/bin/env node
// The inventory's resume (quality/inventory/resume.json): a fresh inventory run of the shards an
// earlier run of the same plan never finished, each by its number in that plan, so the two runs'
// shards together are the plan once. A shard too long for one job's 120 minutes runs split by its
// Playwright projects (quality:full's --project, a project being a cell server on one engine): each
// part is a job of its own, under the shard's own number and plan.
//
// inventory-plan runs it after counting the plan. Without a resume file it writes nothing and the
// run is the whole inventory. With one, it checks the file names shards of the plan just counted
// (the same shard count), writes the resume job's matrix, one entry a job in the file's order, and
// empty lists for the three whole-run matrices, so only the resume job runs.
//
//   node ci/inventory-resume.mjs <resume.json> <shard count> >> "$GITHUB_OUTPUT"
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The resume file, by its path in the repository. */
export const RESUME_FILE = 'quality/inventory/resume.json';

const fail = (message) => {
  throw new Error(`${RESUME_FILE}: ${message}`);
};

/**
 * The resume job's matrix for `resume` in a plan of `count` shards: `{ include }`, one entry a job,
 * in the file's order, a split shard's parts in place of it. Each entry has its shard, a label for
 * its job and artifact names (the shard, or `<shard>-<part>`), its projects joined by commas (empty
 * for a whole shard), and the command that reproduces it. It throws on a file that doesn't name
 * shards of this plan, or splits a shard in a way that isn't a partition of named projects.
 */
export function resumeMatrix(resume, count) {
  if (typeof resume !== 'object' || resume === null || Array.isArray(resume)) {
    fail('is not an object.');
  }
  if (!Number.isInteger(count) || count < 1) fail(`the plan's shard count ${count} isn't one.`);
  if (resume.of !== count) {
    fail(
      `names shards of a plan of ${resume.of} shards, and this plan has ${count}: its numbers no longer name the same tests.`,
    );
  }
  const { shards, split = {} } = resume;
  if (!Array.isArray(shards) || shards.length === 0) fail('names no shards.');
  const seen = new Set();
  for (const shard of shards) {
    if (!Number.isInteger(shard) || shard < 1 || shard > count) {
      fail(`names shard ${JSON.stringify(shard)}, not one of 1 to ${count}.`);
    }
    if (seen.has(shard)) fail(`names shard ${shard} twice.`);
    seen.add(shard);
  }
  if (typeof split !== 'object' || split === null || Array.isArray(split)) {
    fail('split is not an object of shards.');
  }
  for (const [key, parts] of Object.entries(split)) {
    if (!seen.has(Number(key)) || String(Number(key)) !== key) {
      fail(`splits shard ${key}, which it doesn't resume.`);
    }
    if (!Array.isArray(parts) || parts.length < 2)
      fail(`splits shard ${key} into fewer than two parts.`);
    const projects = new Set();
    for (const part of parts) {
      if (!Array.isArray(part) || part.length === 0)
        fail(`splits shard ${key} with an empty part.`);
      for (const project of part) {
        if (
          typeof project !== 'string' ||
          project.trim() !== project ||
          !project ||
          project.includes(',')
        ) {
          fail(`splits shard ${key} with a project name ${JSON.stringify(project)}.`);
        }
        if (projects.has(project)) fail(`splits shard ${key} with ${project} in two parts.`);
        projects.add(project);
      }
    }
  }
  const repro = (shard, projects) =>
    [
      `pnpm ci:quality-full --shard=${shard}/${count}`,
      ...projects.map((project) => `'--project=${project}'`),
    ].join(' ');
  return {
    include: shards.flatMap((shard) => {
      const parts = split[String(shard)];
      if (!parts) return [{ shard, label: String(shard), projects: '', repro: repro(shard, []) }];
      return parts.map((part, at) => ({
        shard,
        label: `${shard}-${at + 1}`,
        projects: part.join(','),
        repro: repro(shard, part),
      }));
    }),
  };
}

/**
 * What inventory-plan's resume step writes to GITHUB_OUTPUT for `file` in a plan of `count`
 * shards: nothing without the file (the whole inventory), else the resume job's matrix and empty
 * lists for inventory-1 to -3.
 */
export function resumeOutputs(file, count) {
  if (!existsSync(file)) return { lines: [], jobs: 0 };
  const matrix = resumeMatrix(JSON.parse(readFileSync(file, 'utf8')), count);
  return {
    lines: [`matrix=${JSON.stringify(matrix)}`, 'shards1=[]', 'shards2=[]', 'shards3=[]'],
    jobs: matrix.include.length,
  };
}

function main(argv) {
  const [file, count] = argv;
  if (!file || !/^\d+$/.test(count ?? '')) {
    console.error('usage: inventory-resume.mjs <resume.json> <shard count>');
    return 2;
  }
  try {
    const { lines, jobs } = resumeOutputs(file, Number(count));
    for (const line of lines) console.log(line);
    const note = jobs
      ? `The run resumes ${jobs} job(s) of the plan's ${count} shards (${file}).`
      : `No ${file}: the run is the whole inventory.`;
    console.error(note);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${note}\n`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
