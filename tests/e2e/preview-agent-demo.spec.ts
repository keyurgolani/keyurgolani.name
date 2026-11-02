import { AGENT_MARKER, scriptsDuring } from '../harness/agent-chunks';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';

// The preview agent's code under demo (#7, Slice 3): the bundled sample and
// the home page load none of it. preview-channel.spec.ts checks public
// pages and Studio under owner, and that a preview document does load it.

test.use({ appOptions: DEMO_APP });

test(
  "the sample loads none of the preview agent's code (#7, Slice 3)",
  { annotation: [{ type: 'route', description: '/sample' }] },
  async ({ page }) => {
    for (const target of ['/', '/sample']) {
      const scripts = await scriptsDuring(page, () => page.goto(target));
      expect(scripts.size, target).toBeGreaterThan(0);
      for (const [url, body] of scripts) {
        expect(body.includes(AGENT_MARKER), `${target}: ${url}`).toBe(false);
      }
    }
  },
);
