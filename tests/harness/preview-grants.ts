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
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, type Frame, type Page, type Response } from '@playwright/test';
import type { Draft, RevisionId } from '../../packages/core/src/owner';
import { DEFAULT_SITE } from './app-server.mjs';
import type { App } from './fixtures';
import type { StoreAnswer, StoreStep, StoreTask } from './preview-store';

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

/**
 * The worker's store process, started as the worker loads this file. A
 * step then takes what the store's own work takes, as it did in the worker:
 * a new process for each, about half a second, left a Studio page quiet long
 * enough that Playwright counted it idle before its grant's frame mounted,
 * and never again after, so a wait for `networkidle` there never ended.
 */
const store = (() => {
  const child = spawn(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', STORE_STEP],
    {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let next = 0;
  let stderr = '';
  let ended: string | null = null;
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const answer = JSON.parse(line) as StoreAnswer;
    const step = waiting.get(answer.id);
    waiting.delete(answer.id);
    if (answer.ok) step?.resolve(answer.value);
    else step?.reject(new Error(answer.error));
  });
  child.on('exit', (code, signal) => {
    ended = `preview-store.ts exited ${code ?? signal}: ${stderr.trim()}`;
    for (const step of waiting.values()) step.reject(new Error(ended));
    waiting.clear();
  });
  child.stdin.on('error', () => {});
  // It ends with the worker, as its input closes, and keeps no worker running.
  child.unref();
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    (stream as unknown as { unref(): void }).unref();
  }
  return (task: Omit<StoreTask, 'id'>) =>
    new Promise<unknown>((resolve, reject) => {
      if (ended) return reject(new Error(ended));
      const id = next++;
      waiting.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ ...task, id })}\n`);
    });
})();

/** Runs `step` on the server's data directory in the store process, and returns what it answered. */
function storeStep(app: App, step: StoreStep): Promise<unknown> {
  const dataDir = app.env.PORTFOLIO_DATA_DIR;
  if (!dataDir) return Promise.reject(new Error('The app runs with no data directory.'));
  return store({ dataDir, step });
}

/**
 * The working draft, made or replaced, holding a portfolio named `name` and
 * `site`'s text, or the `portfolio` text given in place of the named one.
 */
export async function seedDraft(
  app: App,
  name: string,
  site?: string,
  portfolio?: string,
): Promise<Draft> {
  return (await storeStep(app, {
    op: 'seed',
    documents: unit(portfolio ?? portfolioNamed(name), site),
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
