// The pack axes' half of item 8's proof (#6, AC2), on a public page: a
// visitor who switches the typography downloads that typography's files,
// its stylesheet and its fonts by ASSET_MANIFEST, and no other unit's, the
// variant's and the other packs' already in hand. tests/trace/catalog.spec.ts
// holds the variant axis's half.
//
// The trace's site publishes fixture-type-font, which ships a font, and
// leaves the typography to the visitor, when the build registers it
// (BUDGET_FIXTURES=1, targets.ts), so the page offers a second one to switch
// to. It runs in fixture-variant-medium's read-only project alone. The
// trace's policy lets through GET and HEAD alone; this spec alone lets
// through the control's POST to /api/appearance on the app's own origin,
// which saves the choice, and nothing else.
import type { Page, Request } from '@playwright/test';
import { assetManifest, expect, test } from './fixtures';
import { TRACE_TYPOGRAPHY, type TraceTarget } from './targets';

test.beforeEach(({}, testInfo) => {
  const target = testInfo.project.metadata as unknown as TraceTarget;
  test.skip(
    target.composition !== 'fixture-variant-medium' ||
      target.profile !== 'read-only' ||
      !target.publishesFont,
    "the axis switch traces fixture-variant-medium's read-only project, on a build with a second typography",
  );
});

interface UnitFile {
  readonly url: string;
}

interface Unit {
  readonly kind: string;
  readonly id: string;
  readonly stylesheet: UnitFile | null;
  readonly fonts: readonly UnitFile[];
  readonly images: readonly UnitFile[];
  readonly stills: readonly UnitFile[];
}

const units = () => assetManifest().units as Unit[];

/** Which unit each of the build's unit files is, by URL path, as `kind id`. */
function unitOwners(): Map<string, string> {
  const owners = new Map<string, string>();
  for (const unit of units()) {
    for (const file of [unit.stylesheet, ...unit.fonts, ...unit.images, ...unit.stills]) {
      if (file) owners.set(file.url, `${unit.kind} ${unit.id}`);
    }
  }
  return owners;
}

/** Lets the appearance control's save through, on the app's own origin alone. */
async function allowSave(page: Page, origin: string) {
  await page.route(`${origin}/api/appearance`, (route) =>
    route.request().method() === 'POST' ? route.continue() : route.fallback(),
  );
}

test("switching the typography downloads that typography's files, and no other unit's (#6, item 8)", async ({
  page,
  app,
}) => {
  await allowSave(page, app.origin);
  await page.goto('/', { waitUntil: 'networkidle' });
  const boundary = page.locator('[data-appearance-boundary="document"]').first();
  await expect(boundary).toHaveAttribute('data-typography', TRACE_TYPOGRAPHY);
  const other = units().find(
    (unit) => unit.kind === 'typography' && unit.id !== TRACE_TYPOGRAPHY && unit.stylesheet,
  );
  expect(other, 'a second typography to switch to').toBeDefined();

  // From here on: what the switch asks for.
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  await page.getByText('Appearance', { exact: true }).click();
  await page.getByLabel('Typography').selectOption(other!.id);
  await expect(boundary).toHaveAttribute('data-typography', other!.id, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');

  const owners = unitOwners();
  const files = [
    ...new Set(
      requests
        .map((request) => new URL(request.url()).pathname)
        .filter((pathname) => pathname.startsWith('/_portfolio/')),
    ),
  ].sort();
  expect(files, "the new typography's stylesheet").toContain(other!.stylesheet!.url);
  expect(
    files.map((file) => [file, owners.get(file) ?? 'no unit']),
    "the switch downloads the new typography's files alone",
  ).toEqual(files.map((file) => [file, `typography ${other!.id}`]));
});
