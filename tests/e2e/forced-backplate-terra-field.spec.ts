import { expect, test } from '../harness/fixtures';
import { annotation, FORCED_CASES, fixtureIn, openForced, vanishedAmong } from './forced-backplate';

// Terra Field under forced colours: its masthead, an accent band, inks its words in the ink for the
// accent. The browser lays a backplate of the palette's Canvas under each line of text, so words in
// an ink that forced colours map to Canvas vanish into it. Each is judged in pixels against its
// backplate (forced-backplate.ts), in both system palettes, at 1024 and 390.

test.use({ appOptions: fixtureIn('terra-field') });

const TEXTS: Record<string, readonly string[]> = {
  '/': ['.tf-mast .tf-mast__name', '.tf-mast .tf-linkbtn'],
  '/work/project-name': ['.tf-mast .tf-mast__name', '.tf-mast .tf-linkbtn'],
};

for (const at of FORCED_CASES.filter(({ route }) => TEXTS[route]?.length)) {
  test(
    `under forced colours, in the ${at.palette} palette, at ${at.width}, ${at.route === '/' ? 'home' : "a work's page"}: the masthead's name and Field notes read on their backplate`,
    { annotation: annotation(at.route) },
    async ({ page }) => {
      await openForced(page, at);
      const { judged, vanished } = await vanishedAmong(page, TEXTS[at.route]!);
      expect(judged, 'texts judged').toBeGreaterThan(0);
      expect(vanished, 'words that vanish into their backplate').toEqual([]);
    },
  );
}
