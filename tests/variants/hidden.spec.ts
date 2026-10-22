import { HIDDEN_CANARY } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { visitorOutput } from '../harness/visitor-output';
import { READ_ONLY } from './target';

// The hidden-canary fixture under a registered composition (#5, Slice 6;
// #10): its marker sits in hidden sections, in the records, media, practice
// part, and contact record only they reach, in a private work and its asset,
// and in unregistered extension data. It reaches neither the page's HTML,
// its JSON-LD, its RSC payload, which carries every prop a client component
// gets, nor the feed. The config runs this spec in the hidden-canary
// projects alone.

test(
  'the hidden canary reaches neither the HTML, the JSON-LD, the RSC payload, nor the feed',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ request }) => {
    const { html, jsonLd, payload, feed } = await visitorOutput(request);
    const structured = JSON.stringify(jsonLd);
    // Each did render the portfolio.
    expect(html).toContain('Notes on visible things');
    expect(payload).toContain('Notes on visible things');
    expect(feed).toContain('Notes on visible things');
    expect(structured).toContain('Robin Hidden');
    for (const [name, text] of Object.entries({ html, jsonLd: structured, payload, feed })) {
      expect(text, name).not.toContain(HIDDEN_CANARY);
    }
  },
);
