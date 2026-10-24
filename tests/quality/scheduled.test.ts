import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { VISUAL_IMAGE } from './lib/visual';

// #11's nightly matrix and the PR run's change-directed cells (11-4), as
// the workflows wire them: the sharded quality:full in the pinned image, a
// night's slice at a time, each shard's reports scrubbed before they
// upload, the merged verdict over every shard, and the PR set's change
// base. full-shards.test.ts holds the shard count, the cap, and the timeout.

interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, unknown>;
}
interface Job {
  readonly name?: string;
  readonly needs?: readonly string[];
  readonly outputs?: Record<string, string>;
  readonly 'timeout-minutes'?: number;
  readonly if?: string;
  readonly permissions?: unknown;
  readonly container?: { readonly image?: string };
  readonly env?: Record<string, string>;
  readonly strategy?: {
    readonly 'fail-fast'?: boolean;
    readonly matrix?: { readonly shard?: readonly number[] | string };
  };
  readonly steps: readonly Step[];
}
interface Workflow {
  readonly on: { readonly schedule?: readonly { readonly cron: string }[] };
  readonly jobs: Record<string, Job>;
}

const read = (file: string) =>
  parse(
    readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'),
  ) as Workflow;
const SCHEDULED = read('scheduled.yml');
const CI = read('ci.yml');
const SCRIPTS = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

const step = (job: Job, match: (step: Step) => boolean, what: string) => {
  const found = job.steps.find(match);
  assert.ok(found, what);
  return found;
};

/** The days of the week a cron's last field names, 0 for Sunday. */
function days(field: string): number[] {
  if (field === '*') return [0, 1, 2, 3, 4, 5, 6];
  return field.split(',').flatMap((part) => {
    const [from, to] = part.split('-').map(Number);
    return Array.from({ length: (to ?? from!) - from! + 1 }, (_, index) => from! + index);
  });
}

test('the scheduled workflow runs once every night, so the matrix is nightly and links weekly', () => {
  const crons = SCHEDULED.on.schedule?.map(({ cron }) => cron) ?? [];
  const nights = crons.flatMap((cron) => {
    const fields = cron.split(/\s+/);
    assert.equal(fields.length, 5, cron);
    assert.deepEqual(fields.slice(0, 4), ['23', '6', '*', '*'], cron);
    return days(fields[4]!);
  });
  assert.deepEqual(
    [...nights].sort(),
    [0, 1, 2, 3, 4, 5, 6],
    'every night once, and no night twice',
  );
  assert.ok(crons.includes('23 6 * * 1'), 'the Monday run, which links needs');
  assert.equal(SCHEDULED.jobs.links?.if, "${{ github.event.schedule == '23 6 * * 1' }}");
  for (const id of ['quality-night', 'quality-full', 'quality-verdict']) {
    assert.doesNotMatch(SCHEDULED.jobs[id]?.if ?? '', /schedule/, `${id} runs every night`);
  }
});

test("quality-night takes the night's UTC date once, for every shard to read its slice from", () => {
  const job = SCHEDULED.jobs['quality-night'];
  assert.ok(job, 'the scheduled workflow has quality-night');
  assert.equal(job.permissions, undefined);
  assert.deepEqual(job.outputs, { night: '${{ steps.night.outputs.night }}' });
  const night = step(job, (each) => each.id === 'night', 'the date step');
  assert.equal(night.run, 'echo "night=$(date -u +%F)" >> "$GITHUB_OUTPUT"');
  // It checks nothing out and installs nothing: a date is all it gives.
  assert.equal(job.steps.length, 1);
});

test('quality-full shards quality:full in the pinned image, scrubs however it ended, and uploads only a clean scrub', () => {
  const job = SCHEDULED.jobs['quality-full'];
  assert.ok(job, 'the scheduled workflow has quality-full');
  assert.deepEqual(job.needs, ['quality-night']);
  assert.equal(job.container?.image, VISUAL_IMAGE);
  assert.equal(job.env?.QUALITY_CONTAINER, VISUAL_IMAGE);
  assert.equal(job.permissions, undefined, "it keeps the workflow's contents: read");
  const shards = job.strategy?.matrix?.shard ?? [];
  assert.ok(Array.isArray(shards) && shards.length > 1, 'it shards, by a list of its own');
  assert.deepEqual(
    shards,
    (shards as readonly number[]).map((_, index) => index + 1),
  );
  const total = shards.length;
  assert.equal(job.name, `quality-full (\${{ matrix.shard }}/${total})`);

  const run = step(job, (each) => /pnpm ci:quality-full/.test(each.run ?? ''), 'the run step');
  assert.equal(run.run, 'pnpm ci:quality-full "--shard=$SHARD" "--night=$NIGHT"');
  assert.equal(run.env?.SHARD, `\${{ matrix.shard }}/${total}`);
  const night = '${{ needs.quality-night.outputs.night }}';
  assert.equal(run.env?.NIGHT, night);
  assert.equal(
    run.env?.CI_REPRO_COMMAND,
    `pnpm ci:quality-full --shard=\${{ matrix.shard }}/${total} --night=${night}`,
  );
  assert.ok(run.env?.QUALITY_CANARY_FILE && run.env?.QUALITY_SECRETS_FILE);
  // The nightly run is the close and scheduled runs' build: the reference variant installed from its tarball.
  assert.equal(
    SCRIPTS['ci:quality-full'],
    'node ci/run.mjs quality-full -- pnpm quality:full -- --external-variant',
  );

  const steps = job.steps;
  const scrub = step(job, (each) => each.id === 'scrub', 'the scrub step');
  assert.equal(scrub.run, 'node tests/quality/scrub.mjs');
  assert.equal(scrub.if, '${{ always() }}');
  assert.deepEqual(scrub.env, {
    QUALITY_CANARY_FILE: run.env?.QUALITY_CANARY_FILE,
    QUALITY_SECRETS_FILE: run.env?.QUALITY_SECRETS_FILE,
  });
  const uploads = steps.filter((each) => /^actions\/upload-artifact@/.test(each.uses ?? ''));
  assert.equal(uploads.length, 1, 'one upload, the scrubbed reports');
  assert.equal(uploads[0]!.if, "${{ always() && steps.scrub.outcome == 'success' }}");
  assert.equal(uploads[0]!.with?.name, 'reports-quality-full-${{ matrix.shard }}');
  assert.equal(uploads[0]!.with?.path, 'reports/');
  assert.ok(steps.indexOf(scrub) < steps.indexOf(uploads[0]!), 'the scrub runs before the upload');
  assert.doesNotMatch(JSON.stringify(job), /secrets\./);
});

test('quality-verdict judges every shard whole, however they ended, from their own directory', () => {
  const job = SCHEDULED.jobs['quality-verdict'];
  assert.ok(job, 'the scheduled workflow has quality-verdict');
  assert.deepEqual(job.needs, ['quality-full']);
  assert.equal(job.if, '${{ always() }}');
  assert.equal(job.permissions, undefined);
  const total = SCHEDULED.jobs['quality-full']!.strategy!.matrix!.shard!.length;
  const download = step(
    job,
    (each) => /^actions\/download-artifact@/.test(each.uses ?? ''),
    'the download step',
  );
  assert.equal(download.with?.pattern, 'reports-quality-full-*');
  assert.equal(download.with?.path, '${{ runner.temp }}/quality-shards');
  const merge = step(job, (each) => /pnpm ci:quality-verdict/.test(each.run ?? ''), 'the merge');
  assert.equal(merge.env?.SHARDS, download.with?.path);
  assert.equal(merge.run, `pnpm ci:quality-verdict "$SHARDS" --shards ${total} --mode full`);
  assert.equal(
    SCRIPTS['ci:quality-verdict'],
    'node ci/run.mjs quality-verdict -- pnpm quality:merge --',
  );
  assert.ok(job.steps.indexOf(download) < job.steps.indexOf(merge));
  const upload = step(
    job,
    (each) => /^actions\/upload-artifact@/.test(each.uses ?? ''),
    'the upload step',
  );
  assert.equal(upload.with?.name, 'reports-quality-verdict');
  // The rolling report hears about both.
  for (const id of ['quality-full', 'quality-verdict']) {
    assert.ok(SCHEDULED.jobs.report?.needs?.includes(id), `report needs ${id}`);
  }
  // It downloads every job's reports, the eight shards' too, so it gets the time.
  assert.ok((SCHEDULED.jobs.report?.['timeout-minutes'] ?? 0) >= 15);
});

test("quality-pr keeps the merge's base tip and names it, so the PR set takes the [37] rule's cells", () => {
  const job = CI.jobs['quality-pr']!;
  const checkout = step(job, (each) => /^actions\/checkout@/.test(each.uses ?? ''), 'checkout');
  assert.equal(checkout.with?.['fetch-depth'], 2);
  const run = step(job, (each) => /pnpm ci:quality-pr /.test(each.run ?? ''), 'the run step');
  assert.equal(run.env?.QUALITY_CHANGED_BASE, 'HEAD^1');
});

test('quality-pr shards quality:pr in the pinned image, scrubs however it ended, and uploads only a clean scrub', () => {
  const job = CI.jobs['quality-pr']!;
  assert.equal(job.container?.image, VISUAL_IMAGE);
  assert.equal(job.env?.QUALITY_CONTAINER, VISUAL_IMAGE);
  assert.equal(job.permissions, undefined, "it keeps the workflow's contents: read");
  assert.equal(job.strategy?.['fail-fast'], false, 'one shard failing never cancels another');
  // As many shards as quality-pr-plan counts: pr-shards.test.ts holds the count and its wiring.
  assert.equal(
    job.strategy?.matrix?.shard,
    '${{ fromJSON(needs.quality-pr-plan.outputs.shards) }}',
  );
  const total = '${{ needs.quality-pr-plan.outputs.count }}';
  assert.equal(job.name, `quality-pr (\${{ matrix.shard }}/${total})`);
  const run = step(job, (each) => /pnpm ci:quality-pr /.test(each.run ?? ''), 'the run step');
  assert.equal(run.run, 'pnpm ci:quality-pr "--shard=$SHARD"');
  assert.equal(run.env?.SHARD, `\${{ matrix.shard }}/${total}`);
  assert.equal(
    run.env?.CI_REPRO_COMMAND,
    `pnpm ci:quality-pr --shard=\${{ matrix.shard }}/${total}`,
  );
  assert.equal(SCRIPTS['ci:quality-pr'], 'node ci/run.mjs quality-pr -- pnpm quality:pr');

  const scrub = step(job, (each) => each.id === 'scrub', 'the scrub step');
  assert.equal(scrub.run, 'node tests/quality/scrub.mjs');
  assert.equal(scrub.if, '${{ always() }}');
  assert.deepEqual(scrub.env, {
    QUALITY_CANARY_FILE: run.env?.QUALITY_CANARY_FILE,
    QUALITY_SECRETS_FILE: run.env?.QUALITY_SECRETS_FILE,
  });
  const uploads = job.steps.filter((each) => /^actions\/upload-artifact@/.test(each.uses ?? ''));
  assert.equal(uploads.length, 1, 'one upload, the scrubbed reports');
  assert.equal(uploads[0]!.if, "${{ always() && steps.scrub.outcome == 'success' }}");
  assert.equal(uploads[0]!.with?.name, 'reports-quality-pr-shard-${{ matrix.shard }}');
  assert.ok(job.steps.indexOf(scrub) < job.steps.indexOf(uploads[0]!));
  assert.doesNotMatch(JSON.stringify(job), /secrets\./);
});

test("quality-pr-verdict judges quality-pr's shards whole, however they ended, from their own directory", () => {
  const job = CI.jobs['quality-pr-verdict'];
  assert.ok(job, 'ci.yml has quality-pr-verdict');
  assert.deepEqual(job.needs, ['changes', 'quality-pr-plan', 'quality-pr']);
  assert.equal(
    job.if,
    // A failed or skipped shard still reaches it; a cancelled run, such as a superseded push, skips it.
    "${{ !cancelled() && contains(fromJSON(needs.changes.outputs.jobs), 'quality-pr-verdict') }}",
  );
  assert.equal(job.permissions, undefined);
  assert.equal(job.container, undefined, 'it runs no browser');
  const download = step(
    job,
    (each) => /^actions\/download-artifact@/.test(each.uses ?? ''),
    'the download step',
  );
  // The shards' artifacts only: never the verdict's own, which a rerun would find.
  assert.equal(download.with?.pattern, 'reports-quality-pr-shard-*');
  assert.equal(download.with?.path, '${{ runner.temp }}/quality-shards');
  const merge = step(job, (each) => /pnpm ci:quality-pr-verdict/.test(each.run ?? ''), 'the merge');
  assert.equal(merge.env?.SHARDS, download.with?.path);
  assert.equal(merge.env?.SHARD_JOBS, '${{ needs.quality-pr.result }}');
  // Exactly the shards quality-pr-plan counted: one dropped or one extra fails the merge.
  assert.equal(merge.env?.SHARD_COUNT, '${{ needs.quality-pr-plan.outputs.count }}');
  assert.equal(
    merge.run,
    'pnpm ci:quality-pr-verdict "$SHARDS" --shards "$SHARD_COUNT" --mode pr --jobs "$SHARD_JOBS"',
  );
  assert.equal(
    SCRIPTS['ci:quality-pr-verdict'],
    'node ci/run.mjs quality-pr-verdict -- pnpm quality:merge --',
  );
  assert.ok(job.steps.indexOf(download) < job.steps.indexOf(merge));
  assert.equal(merge.if, undefined, 'the merge runs whether or not the download found anything');
  const upload = step(
    job,
    (each) => /^actions\/upload-artifact@/.test(each.uses ?? ''),
    'the upload step',
  );
  assert.equal(upload.with?.name, 'reports-quality-pr-verdict');
  assert.doesNotMatch(JSON.stringify(job), /secrets\.|GITHUB_TOKEN|github\.token/);
});
