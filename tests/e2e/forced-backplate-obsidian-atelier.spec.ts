import { expect, test } from '../harness/fixtures';
import { annotation, FORCED_CASES, fixtureIn, openForced, vanishedAmong } from './forced-backplate';

// Obsidian Atelier under forced colours: its record sleeves ink their series in the scheme's
// inverse ink. The browser lays a backplate of the palette's Canvas under each line of text, so
// words in an ink that forced colours map to Canvas vanish into it. Each is judged in pixels
// against its backplate (forced-backplate.ts), in both system palettes, at 390.

test.use({ appOptions: fixtureIn('obsidian-atelier') });

const TEXTS: Record<string, readonly string[]> = {
  '/': ['.oa-sleeve__series'],
};

for (const at of FORCED_CASES.filter(
  ({ route, width }) => TEXTS[route]?.length && [390].includes(width),
)) {
  test(
    `under forced colours, in the ${at.palette} palette, at ${at.width}, ${at.route === '/' ? 'home' : "a work's page"}: a sleeve's series reads on its backplate`,
    { annotation: annotation(at.route) },
    async ({ page }) => {
      await openForced(page, at);
      const { judged, vanished } = await vanishedAmong(page, TEXTS[at.route]!);
      expect(judged, 'texts judged').toBeGreaterThan(0);
      expect(vanished, 'words that vanish into their backplate').toEqual([]);
    },
  );
}
