import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Response } from '@playwright/test';
import { DEFAULT_SITE } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { mint, mountFrame, publish, seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';

// A grant's generated scheme in the browser (#20), against the built server
// under owner: a revision grant whose revision froze brand-seed's stored
// sets, as #10's 10h will at publish. Its frame links the scheme from the
// grant's own /preview-assets/<grant>/_appearance/ path, never
// /_portfolio/scheme/, the browser loads it as a style, under the grant's
// private, no-store, and the frame's boundary renders the stored tokens.
// Draft grants carry no schemes until 10h pins them at mint.

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

const SHEETS = { type: 'route', description: '/preview-assets/[grant]/_appearance/[file]' };

const record = JSON.parse(
  readFileSync(
    new URL('../../packages/appearance-schemes/generated/brand-seed.json', import.meta.url),
    'utf8',
  ),
) as {
  result: {
    generator: { id: string; version: number };
    input: { seedColor: string };
    tokens: { light: Record<string, string>; dark: Record<string, string> };
  };
};

/** brand-seed's stored record, as a revision's snapshots/schemes.json holds it. */
const STORED = {
  generator: record.result.generator,
  inputsHash: createHash('sha256').update(record.result.input.seedColor).digest('hex'),
  tokens: record.result.tokens,
};

/** The harness site, selecting brand-seed, with the input it's generated from. */
const SITE = `${readFileSync(DEFAULT_SITE, 'utf8').replace(
  /colorScheme: warm-parchment/,
  'colorScheme: brand-seed',
)}\nappearanceInputs:\n  brand-seed:\n    seedColor: '${record.result.input.seedColor}'\n`;

test(
  "a revision grant's frame links its generated scheme from the grant's own _appearance path, loads it as a style, and renders its stored tokens (#20)",
  { annotation: [SHEETS] },
  async ({ page, app }) => {
    expect(SITE).toContain('colorScheme: brand-seed');
    const csrf = await signIn(page, app, secret.password);
    const revision = await publish(app, await seedDraft(app, 'Scheme Person', SITE), {
      schemes: { 'brand-seed': STORED },
    });
    const grant = await mint(page, csrf, { revision });

    const sheets: Response[] = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.includes('/_appearance/')) sheets.push(response);
    });
    const { frame } = await mountFrame(page, `/preview/${grant}`);

    const boundary = frame.locator('[data-appearance-boundary="document"]');
    await expect(boundary).toHaveAttribute('data-color-scheme', 'brand-seed');
    expect(await boundary.getAttribute('data-appearance-fallback')).toBeNull();
    const href = await frame
      .locator('link[rel="stylesheet"][href*="/_appearance/"]')
      .getAttribute('href');
    expect(href).toMatch(
      new RegExp(`^/preview-assets/${grant}/_appearance/brand-seed\\.[0-9a-f]{12}\\.css$`),
    );
    expect(await frame.locator('link[href^="/_portfolio/scheme/"]').count()).toBe(0);

    // The browser loaded it as a style, and the grant's route answered it.
    await expect.poll(() => sheets.length).toBeGreaterThan(0);
    const [sheet] = sheets;
    expect(new URL(sheet!.url()).pathname).toBe(href);
    expect((await sheet!.request().allHeaders())['sec-fetch-dest']).toBe('style');
    expect(sheet!.status()).toBe(200);
    const headers = sheet!.headers();
    expect(headers['content-type']).toBe('text/css; charset=utf-8');
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');

    // Its stored canvas is what the frame's boundary computes, in the light
    // mode the browser prefers.
    const canvas = await boundary.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--color-canvas').trim(),
    );
    expect(canvas.toLowerCase()).toBe(STORED.tokens.light.canvas!.toLowerCase());
  },
);
