import { HIDDEN_CANARY } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { withRscHash } from '../harness/rsc';
import { visitorOutput } from '../harness/visitor-output';
import { projectTarget, READ_ONLY } from './target';

// The hidden-canary fixture under a registered composition (#5, Slice 6;
// #10): its marker sits in hidden sections, in the records, media, practice
// parts, and contact record only they reach, in a hidden github section's
// snapshot and a repository the visible one excludes, in private works,
// evidence, and media wherever they're named, and in unregistered extension
// data. It reaches neither the page's HTML, its JSON-LD, its RSC payload,
// which carries every prop a client component gets, nor the feed. Its two
// case studies, a private work's and one only a hidden section reaches, have
// no page (#10b): each slug is the 404 page, which names neither. The config
// runs this spec in the hidden-canary projects alone.

test(
  'the hidden canary reaches neither the HTML, the JSON-LD, the RSC payload, nor the feed',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ request }, testInfo) => {
    const { html, jsonLd, payload, feed } = await visitorOutput(request);
    const structured = JSON.stringify(jsonLd);
    // Each did render the portfolio, and the host read the snapshot beside it.
    expect(html).toContain('Notes on visible things');
    if (!projectTarget(testInfo).variant.manifest.unsupportedKinds.includes('github')) {
      expect(html).toContain('visible-tools');
    }
    expect(payload).toContain('Notes on visible things');
    expect(feed).toContain('Notes on visible things');
    expect(structured).toContain('Robin Hidden');
    for (const [name, text] of Object.entries({ html, jsonLd: structured, payload, feed })) {
      expect(text, name).not.toContain(HIDDEN_CANARY);
    }
  },
);

test(
  "a private work's case study and one only a hidden section reaches have no page, and their 404 names neither (#10b)",
  { annotation: [{ type: 'route', description: '/work/[slug]' }, READ_ONLY] },
  async ({ request }) => {
    const headers = { RSC: '1' };
    for (const slug of ['canary-hidden-private-slug', 'canary-hidden-record-slug']) {
      const path = `/work/${slug}`;
      const page = await request.get(path, { maxRedirects: 0 });
      const rsc = await request.get(await withRscHash(path, headers), {
        headers,
        maxRedirects: 0,
      });
      for (const [name, response] of Object.entries({ page, rsc })) {
        expect(response.status(), `${path} ${name}`).toBe(404);
        // The 404 names the path it answers, so only the slug's own spelling of the marker may show.
        const text = (await response.text()).split(slug).join('<slug>');
        expect(text, `${path} ${name}`).not.toContain(HIDDEN_CANARY);
      }
    }
  },
);
