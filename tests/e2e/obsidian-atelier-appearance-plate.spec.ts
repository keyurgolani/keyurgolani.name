import { expect, test } from '../harness/fixtures';
import {
  annotation,
  home,
  openFromKeyboard,
  panelText,
  tag,
  onMissingMediaHome,
  type Setting,
} from './obsidian-atelier-appearance';

// Under more contrast and reduced transparency the platform sets the visitor's Appearance control on
// its own opaque plate (platform.ts, APPEARANCE_CONTROL), whatever the composition puts behind it.
// Opened there, the panel's text reads on that plate, at 4.5:1 or more: Obsidian Atelier's own panel
// plate in default contrast never stands between them.

onMissingMediaHome();

async function readPlate(page: Parameters<typeof home>[0], origin: string, setting: Setting) {
  await home(page, origin, setting);
  await openFromKeyboard(page);
  const text = await panelText(page);
  const read = {
    textOnThePlatformsPlate:
      text.parts.length > 0 && text.parts.every((part) => part.onPlate || part.own),
    panelAddsNoGroundOfItsOwn:
      text.panelBackground === text.plateBackground ||
      /^rgba\(0, 0, 0, 0\)$|^transparent$/.test(text.panelBackground),
    textAtLeast45: text.parts.every((part) => part.ratio >= 4.5),
  };
  expect(read, JSON.stringify(text)).toEqual({
    textOnThePlatformsPlate: true,
    panelAddsNoGroundOfItsOwn: true,
    textAtLeast45: true,
  });
}

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test(
    'at 390 in dark under more contrast, the open Appearance panel reads on the platform plate',
    { annotation, tag },
    async ({ page, app }) => {
      await readPlate(page, app.origin, { mode: 'dark', contrast: 'more' });
    },
  );
});

test.describe('1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test(
    'at 1440 in light under more contrast, the open Appearance panel reads on the platform plate',
    { annotation, tag },
    async ({ page, app }) => {
      await readPlate(page, app.origin, { mode: 'light', contrast: 'more' });
    },
  );
  test(
    'at 1440 in dark with reduced transparency, the open Appearance panel reads on the platform plate',
    { annotation, tag },
    async ({ page, app }) => {
      await readPlate(page, app.origin, { mode: 'dark', transparency: 'reduce' });
    },
  );
});
