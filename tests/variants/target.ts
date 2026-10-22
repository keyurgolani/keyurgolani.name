// What the variant specs run against (#5, Slice 6): this checkout's build,
// or the one PORTFOLIO_VARIANTS_WEB names, such as the worktree
// test:external-variant installs the reference variant in, and the variants
// that build registers, all of them or those PORTFOLIO_VARIANTS_ONLY lists.
// Screenshots compare only for the platform's own packages, only in the
// pinned Playwright image, where PORTFOLIO_SCREENSHOTS is `compare`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as Registry from '../../apps/web/src/lib/generated/registry.meta';
import type { AppOptions } from '../harness/fixtures';
import type {
  ContractFixture,
  ContractFixtureName,
} from '../../packages/variant-contract/src/node/fixtures';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The apps/web whose build the specs start. */
export const WEB = path.resolve(
  process.env.PORTFOLIO_VARIANTS_WEB ?? path.join(REPO_ROOT, 'apps', 'web'),
);

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { VARIANTS } = require(
  path.join(WEB, 'src', 'lib', 'generated', 'registry.meta.ts'),
) as typeof Registry;

export type RegisteredVariant = (typeof VARIANTS)[number];

/** The fallback composition's id, which a site can't select. */
export const FALLBACK_ID = 'fallback';
/** The id a site selects to reach the fallback composition: no package registers it. */
export const UNREGISTERED = 'missing-variant';

const only = process.env.PORTFOLIO_VARIANTS_ONLY?.split(',').filter(Boolean);

/** The registered variants the specs check, sorted by id. */
export const UNDER_TEST: readonly RegisteredVariant[] = VARIANTS.filter(
  ({ manifest }) => !only || only.includes(manifest.id),
);
if (only && UNDER_TEST.length !== only.length) {
  throw new Error(`PORTFOLIO_VARIANTS_ONLY names a variant ${WEB} doesn't register: ${only}`);
}

/** Whether `variant` is the platform's own, whose screenshots have baselines. */
export const firstParty = (variant: RegisteredVariant) =>
  variant.packageName.startsWith('@portfolio/');

/** Whether screenshots compare against their baselines in this run. */
export const COMPARE_SCREENSHOTS = process.env.PORTFOLIO_SCREENSHOTS === 'compare';

/** The fixed clock the server starts under, so every render of a fixture is the same. */
export const FIXED_CLOCK = path.join(REPO_ROOT, 'tests', 'harness', 'fixed-clock.mjs');
export const FIXED_TIME = '2026-01-01T00:00:00.000Z';

/** What a site selects to render `variant`: its id, or one nothing registers for the fallback. */
export const selection = (variant: RegisteredVariant) =>
  variant.manifest.id === FALLBACK_ID ? UNREGISTERED : variant.manifest.id;

/** The fixture's site document, selecting `variant`. */
export function siteFor(fixture: ContractFixture, variant: RegisteredVariant): string {
  const text = readFileSync(fixture.files.site, 'utf8');
  const selected = `\n  variant: ${UNREGISTERED}\n`;
  if (!text.includes(selected)) {
    throw new Error(`${fixture.files.site} no longer selects ${UNREGISTERED}.`);
  }
  return text.replace(selected, `\n  variant: ${selection(variant)}\n`);
}

/** A small gray PNG, standing in for an owner's image. */
const IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAAAAADbboAnAAAADklEQVR4nGPYAgUMpDAAj6MhwZIy8f4AAAAASUVORK5CYII=',
  'base64',
);
/** A one-page PDF, standing in for an owner's paper. */
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

/**
 * The files a fixture names on the site itself, such as #4's pairs'
 * /images/... and /papers/..., which an owner would ship in public/:
 * stand-ins for each, so its links and images resolve. missing-media's
 * paths stay missing, on purpose.
 */
export function ownerAssets(fixture: ContractFixture): Record<string, string | Uint8Array> {
  const text = readFileSync(fixture.files.portfolio, 'utf8');
  const assets: Record<string, string | Uint8Array> = {};
  for (const [, value] of text.matchAll(/:\s*['"]?(\/(?!\/)[^\s'"#?]+\.[a-z0-9]+)['"]?\s*$/gim)) {
    if (value!.startsWith('/media/missing-')) continue;
    const file = value!.slice(1);
    assets[file] = /\.pdf$/i.test(file) ? PDF : IMAGE;
  }
  return assets;
}

/** read-only on the fixture, its site selecting `variant`, under the fixed clock. */
export function fixtureApp(fixture: ContractFixture, variant: RegisteredVariant): AppOptions {
  return {
    web: WEB,
    portfolio: fixture.files.portfolio,
    siteText: siteFor(fixture, variant),
    publicFiles: ownerAssets(fixture),
    env: { NODE_OPTIONS: `--import=${pathToFileURL(FIXED_CLOCK).href}` },
  };
}

/** demo on the bundled sample, under the fixed clock. */
export const SAMPLE_APP: AppOptions = {
  web: WEB,
  env: {
    PORTFOLIO_PROFILE: 'demo',
    PORTFOLIO_SOURCE_DIR: '',
    NODE_OPTIONS: `--import=${pathToFileURL(FIXED_CLOCK).href}`,
  },
  portfolio: null,
  site: null,
};

export const READ_ONLY = { type: 'profile', description: 'read-only' };
export const DEMO = { type: 'profile', description: 'demo' };

/** The variant a test's project checks, and the contract fixture it renders, if any. */
export function projectTarget(testInfo: { project: { metadata: Record<string, unknown> } }): {
  readonly variant: RegisteredVariant;
  readonly fixture?: ContractFixtureName;
} {
  const { variant: id, fixture } = testInfo.project.metadata as {
    variant?: string;
    fixture?: ContractFixtureName;
  };
  const variant = UNDER_TEST.find(({ manifest }) => manifest.id === id);
  if (!variant) throw new Error(`The project names no variant under test: ${id}`);
  return { variant, fixture };
}
