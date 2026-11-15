import { expect, test } from '../harness/fixtures';
import {
  annotation,
  home,
  openFromKeyboard,
  panelText,
  rowNow,
  tag,
  onMissingMediaHome,
  walkPanel,
  type Setting,
} from './obsidian-atelier-appearance';

// Obsidian Atelier's visitor Appearance control, opened from the keyboard in default contrast. Its
// panel unfolded in the chrome's top row over the entrance with no ground of its own: at 390 its form
// lay over the plaque and the hero's words, and at 1440 its height re-centred the row, so the name,
// the rooms and the running head dropped over the hero. Open, the panel's text reads at 4.5:1 or
// more on a plate of the panel's own; the row's parts keep their tops and the summary its height; at
// 390 the panel stands inside the viewport with no sideways scroll, and at 200% root text it holds
// its whole form; and Tab walks the form's controls, each passing the focus check.

onMissingMediaHome();

async function readOpen(
  page: Parameters<typeof home>[0],
  origin: string,
  setting: Setting,
  phone?: number,
) {
  await home(page, origin, setting);
  const closed = await rowNow(page);
  const closedWide = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  await openFromKeyboard(page);
  const open = await rowNow(page);
  const text = await panelText(page);
  const stops = await walkPanel(page);
  const read = {
    textOnItsOwnPlate: text.parts.length > 0 && text.parts.every((part) => part.own),
    textAtLeast45: text.parts.every((part) => part.ratio >= 4.5),
    rowStays: Object.entries(closed.tops).every(
      ([part, top]) => Math.abs((open.tops[part] ?? -99) - top) <= 1,
    ),
    summaryKeepsItsHeight: Math.abs(open.summary - closed.summary) <= 0.5,
    // At the default text size, against the phone's own width: a page wider than it widens the
    // window a phone emulates, so innerWidth would follow it, and the page is held to it too. At
    // 200% root text the page already runs wider than the phone with the panel closed, a reflow of
    // its own, and the window it lays out in widens with it: there the open panel stays inside that
    // window and adds no width to the page.
    insideTheViewport:
      phone === undefined ||
      (setting.rootText === undefined
        ? text.box[0]! >= -0.5 && text.box[2]! <= phone + 0.5 && text.pageWide <= phone
        : text.box[0]! >= -0.5 &&
          text.box[2]! <= text.viewport + 0.5 &&
          text.pageWide <= closedWide),
    holdsItsForm: !text.overflowing && text.controlsInside,
    tabWalksTheForm: stops.length > 0,
    eachStopPassesTheFocusCheck: stops.every((stop) => stop.findings.length === 0),
  };
  const why = JSON.stringify({ closed, closedWide, open, text, stops });
  expect(read, why).toEqual({
    textOnItsOwnPlate: true,
    textAtLeast45: true,
    rowStays: true,
    summaryKeepsItsHeight: true,
    insideTheViewport: true,
    holdsItsForm: true,
    tabWalksTheForm: true,
    eachStopPassesTheFocusCheck: true,
  });
}

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const mode of ['light', 'dark'] as const) {
    test(
      `at 390 in ${mode}, the open Appearance panel reads on a plate of its own, inside the viewport, and the row stays`,
      { annotation, tag },
      async ({ page, app }) => {
        await readOpen(page, app.origin, { mode }, 390);
      },
    );
  }
  test(
    'at 390 in light with the root text at 200%, the open Appearance panel holds its whole form inside the viewport',
    { annotation, tag },
    async ({ page, app }) => {
      await readOpen(page, app.origin, { mode: 'light', rootText: '200%' }, 390);
    },
  );
});

test.describe('1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  for (const mode of ['light', 'dark'] as const) {
    test(
      `at 1440 in ${mode}, the open Appearance panel reads on a plate of its own and the row stays`,
      { annotation, tag },
      async ({ page, app }) => {
        await readOpen(page, app.origin, { mode });
      },
    );
  }
});
