// Preview grants in the browser (#7, Slice 2), against the built server
// under owner. The owner signs in through #2's form, and a Studio page the
// browser has open mints and revokes grants over /api/studio, as Studio
// does: same origin, with the session's CSRF token. A frame mounts on that
// page with the sandbox Studio will give it (Slice 4). Until #3's Studio
// commands write drafts (#3, Slice 2), the drafts and revisions grants
// render are seeded straight into the server's data directory, as the
// operator's CLI writes them; the server reads them at its next request.
// The store's code is server code, so each seed or publish runs in a child
// process under the react-server condition (preview-store.ts).
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, type Frame, type Page, type Response } from '@playwright/test';
import type { Draft, RevisionId } from '../../packages/core/src/owner';
import { DEFAULT_SITE } from './app-server.mjs';
import type { App } from './fixtures';
import type { StoreStep, StoreTask } from './preview-store';

/** The environment a frame starts in, as Slice 4's controls leave it. */
export const ENVIRONMENT = {
  displayMode: 'system',
  contrast: 'system',
  motion: 'system',
  enhancement: 'on',
} as const;

/** A portfolio whose identity names `name`, which a test finds in a frame and nowhere else. */
export const portfolioNamed = (name: string) =>
  `schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: ${name}\n  tagline: Draws calm maps.\nsections:\n  - kind: lede\n    id: about\n    body: Hi from ${name}.\n`;

const unit = (portfolio: string, site = readFileSync(DEFAULT_SITE, 'utf8')) => ({
  portfolio: { format: 'yaml' as const, sourceText: portfolio },
  site: { format: 'yaml' as const, sourceText: site },
});

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const STORE_STEP = fileURLToPath(new URL('preview-store.ts', import.meta.url));

/** Runs `step` on the server's data directory in a child, under react-server, and returns what it printed. */
async function storeStep(app: App, step: StoreStep): Promise<unknown> {
  const dataDir = app.env.PORTFOLIO_DATA_DIR;
  if (!dataDir) throw new Error('The app runs with no data directory.');
  const task: StoreTask = { dataDir, step };
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', STORE_STEP, JSON.stringify(task)],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 },
  );
  return JSON.parse(stdout.trim().split('\n').pop() ?? '');
}

/** The working draft, made or replaced, holding a portfolio named `name` and `site`'s text. */
export async function seedDraft(app: App, name: string, site?: string): Promise<Draft> {
  return (await storeStep(app, {
    op: 'seed',
    documents: unit(portfolioNamed(name), site),
  })) as Draft;
}

/** Publishes `draft` as the operator would, which removes it. Returns the new revision. */
export async function publish(app: App, draft: Draft): Promise<RevisionId> {
  return (await storeStep(app, {
    op: 'publish',
    draftId: draft.draftId,
    draftVersion: draft.version,
  })) as RevisionId;
}

/** Signs in through the form, from a fresh page, and returns the session's CSRF token. */
export async function signIn(page: Page, app: App, password: string): Promise<string> {
  await page.goto('/studio/sign-in');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${app.origin}/studio`);
  const session = await page.evaluate(async () => {
    const response = await fetch('/api/studio/auth.session');
    return (await response.json()) as { data: { csrfToken: string } };
  });
  return session.data.csrfToken;
}

/** A Studio command from the open Studio page, as Studio sends one. */
export function command(
  page: Page,
  csrf: string,
  name: string,
  input: unknown,
): Promise<{ status: number; body: { data?: Record<string, unknown>; error?: { code: string } } }> {
  return page.evaluate(
    async ({ name, input, csrf }) => {
      const response = await fetch(`/api/studio/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify(input),
      });
      return { status: response.status, body: await response.json() };
    },
    { name, input, csrf },
  );
}

/** Mints a grant of `subject`, and returns it. */
export async function mint(
  page: Page,
  csrf: string,
  subject: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const minted = await command(page, csrf, 'preview.grant.mint', {
    subject,
    environment: ENVIRONMENT,
    ...extra,
  });
  expect(minted.status, JSON.stringify(minted.body)).toBe(200);
  expect(minted.body.data?.status).toBe('active');
  return minted.body.data?.grant as string;
}

/** A grant of `draft`'s current version. */
export const mintDraft = (page: Page, csrf: string, draft: Draft) =>
  mint(page, csrf, { draft: draft.draftId, version: draft.version });

/**
 * Mounts a frame on the open page for `path`, below /preview/<grant>, with
 * Studio's sandbox, and returns it once it loaded, with the response its
 * document came in.
 */
export async function mountFrame(
  page: Page,
  path: string,
): Promise<{ frame: Frame; response: Response }> {
  const [response] = await Promise.all([
    page.waitForResponse((each) => new URL(each.url()).pathname === path),
    page.evaluate(
      (src) =>
        new Promise<void>((resolve) => {
          for (const old of Array.from(document.querySelectorAll('iframe[data-preview]'))) {
            old.remove();
          }
          const iframe = document.createElement('iframe');
          iframe.setAttribute('data-preview', '');
          iframe.setAttribute('sandbox', 'allow-scripts');
          iframe.setAttribute('referrerpolicy', 'no-referrer');
          iframe.setAttribute('allow', '');
          iframe.addEventListener('load', () => resolve(), { once: true });
          iframe.src = src;
          document.body.append(iframe);
        }),
      path,
    ),
  ]);
  const frame = page.frames().find((each) => new URL(each.url()).pathname === path);
  if (!frame) throw new Error(`No frame loaded ${path}.`);
  await frame.waitForLoadState('load');
  return { frame, response };
}
