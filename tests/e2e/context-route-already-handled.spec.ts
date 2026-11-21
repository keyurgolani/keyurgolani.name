import { expect, test } from '../harness/fixtures';

// tests/harness/fixtures.ts's blockedRequests route lets the app's own requests through, at the
// context. A spec's page route can still be deciding one of them when the test lets its routes go,
// as page.unrouteAll({ behavior: 'ignoreErrors' }) in an afterEach does. Playwright then sends that
// request on itself, the page route's own answer fails, and Playwright hands the route to the
// context's routes, which find it already handled. That says nothing about the app: the request
// has gone on, so the context route has nothing left to let through, and the test fails nothing.

test("an app request a page route still holds as the test lets its routes go reaches the context's routes already handled, and fails nothing", async ({
  page,
  context,
}) => {
  await page.goto('/api/health');
  // Registered after the fixture's route, so it runs first, and only passes the request on: what it
  // sees is what reaches the context's routes.
  const reached: string[] = [];
  await context.route('**/held-by-the-page', (route) => {
    reached.push(route.request().url());
    return route.fallback();
  });
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => (open = resolve));
  let holding = false;
  // A page route that answers with a round trip of its own, as studio-load-failure.spec.ts's
  // late-alert hold does, so the routes go while it's still deciding.
  await page.route('**/held-by-the-page', async (route) => {
    holding = true;
    await gate;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  const status = page.evaluate(() =>
    fetch('/held-by-the-page').then((response) => response.status),
  );
  await expect.poll(() => holding, 'the page route holds the request').toBe(true);
  open();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await expect.poll(() => reached.length, "the request reaches the context's routes once").toBe(1);
  // One more round trip, so the context route's own answer is back before the test ends.
  await page.evaluate(() => document.readyState);
  expect(await status, 'the page still gets an answer').toBeGreaterThan(0);
});
