// What visitors get from the app under test: the HTML of / (its JSON-LD
// included, and parsed), the RSC payload of /, which carries every prop a
// client component gets, rendered or not, and /feed.xml. Specs check each
// for markers that must never reach a visitor.
import { expect, type APIRequestContext } from '@playwright/test';
import { withRscHash } from './rsc';

export interface VisitorOutput {
  readonly html: string;
  /** The page's JSON-LD blocks, parsed. */
  readonly jsonLd: readonly Record<string, unknown>[];
  readonly payload: string;
  readonly feed: string;
}

const JSON_LD = /<script\b[^>]*\btype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

export async function visitorOutput(request: APIRequestContext): Promise<VisitorOutput> {
  const home = await request.get('/');
  expect(home.status()).toBe(200);
  const headers = { RSC: '1' };
  const rsc = await request.get(await withRscHash('/', headers), { headers, maxRedirects: 0 });
  expect(rsc.status()).toBe(200);
  expect(rsc.headers()['content-type']).toContain('text/x-component');
  const feed = await request.get('/feed.xml');
  expect(feed.status()).toBe(200);
  const html = await home.text();
  const jsonLd = [...html.matchAll(JSON_LD)].map(
    ([, text]) => JSON.parse(text!) as Record<string, unknown>,
  );
  return { html, jsonLd, payload: await rsc.text(), feed: await feed.text() };
}
