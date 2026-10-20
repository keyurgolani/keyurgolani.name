// What visitors get from the app under test: the HTML of / (its JSON-LD
// included), the RSC payload of /, which carries every prop a client
// component gets, rendered or not, and /feed.xml. Specs check each for
// markers that must never reach a visitor.
import { expect, type APIRequestContext } from '@playwright/test';

export interface VisitorOutput {
  readonly html: string;
  readonly payload: string;
  readonly feed: string;
}

export async function visitorOutput(request: APIRequestContext): Promise<VisitorOutput> {
  const home = await request.get('/');
  expect(home.status()).toBe(200);
  const rsc = await request.get('/', { headers: { RSC: '1' } });
  expect(rsc.status()).toBe(200);
  expect(rsc.headers()['content-type']).toContain('text/x-component');
  const feed = await request.get('/feed.xml');
  expect(feed.status()).toBe(200);
  return { html: await home.text(), payload: await rsc.text(), feed: await feed.text() };
}
