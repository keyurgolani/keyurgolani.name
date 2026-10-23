import { runCanary } from './lib/env';
import { CANARY_COOKIE, expect, test } from './fixtures';

// The canary probe (#11, Slice 1, item 11): every request carries the run's
// canary, and this test's trace is kept whether it passes or not, so the
// artifacts hold the canary until run.ts scrubs them. run.ts fails the run
// when the probe ran and no artifact held it before the scrub (the scan
// would prove nothing), or when any still holds it after.

// Trace is a worker option, so it's set for the file.
test.use({ trace: 'on' });

test(
  'every request the page makes carries the canary, and its trace holds it until the scrub',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }, testInfo) => {
    const canary = runCanary();
    const sent: Record<string, string>[] = [];
    page.on('request', (request) => sent.push(request.headers()));
    await page.goto('/');
    expect(sent.length).toBeGreaterThan(0);
    // Compared here, so the canary never becomes an expectation the trace records.
    const carried = sent.filter(
      (headers) =>
        headers['authorization'] === `Bearer ${canary}` && headers['x-csrf-token'] === canary,
    );
    expect(carried.length, 'requests carrying the canary as Authorization and CSRF').toBe(
      sent.length,
    );
    const cookies = await page.context().cookies();
    const cookie = cookies.find((each) => each.name === CANARY_COOKIE)?.value === canary;
    expect(cookie, 'the canary cookie').toBe(true);
    testInfo.annotations.push({ type: 'quality-canary-probe', description: 'trace on' });
  },
);
