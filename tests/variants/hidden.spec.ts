import { HIDDEN_CANARY } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { visitorOutput } from '../harness/visitor-output';
import { READ_ONLY } from './target';

// The hidden-canary fixture under a registered composition (#5, Slice 6):
// its marker sits in hidden sections and in unregistered extension data,
// and reaches neither the page's HTML nor its RSC payload, which carries
// every prop a client component gets, nor the feed. The config runs this
// spec in the hidden-canary projects alone.

test(
  'the hidden canary reaches neither the HTML, the RSC payload, nor the feed',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ request }) => {
    const { html, payload, feed } = await visitorOutput(request);
    // Each did render the portfolio.
    expect(html).toContain('Notes on visible things');
    expect(payload).toContain('Notes on visible things');
    for (const [name, text] of Object.entries({ html, payload, feed })) {
      expect(text, name).not.toContain(HIDDEN_CANARY);
    }
  },
);
