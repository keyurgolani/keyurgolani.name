import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HistoryButtons,
  StudioMark,
  contentDrags,
  cssLength,
  DeviceWidths,
  INITIAL_SNAP,
  nearestSnap,
  nextChoice,
  panelRoom,
  RadioChoices,
  RAIL,
  RAIL_KEY,
  railKey,
  railWidth,
  readRail,
  revealRoom,
  revealTarget,
  type RevealGeometry,
  ScaleBadge,
  SHEET_SNAPS,
  StudioSplit,
} from './studio-split';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The Appearance workspace's layout (owner direction, 2026-10-25; the design
// dossier's 3.1, 3.4, and 3.5): the rail's width and its keys, the sheet's
// snap points and when its content drags it, the APG radio group's arrows,
// and the markup both Studios lay out in.

/** Each native radio in `html`, by its option: its group's name, whether it's checked or off, and its name. */
const radiosIn = (html: string) =>
  [...html.matchAll(/data-option="([^"]+)"><input type="radio" ([^>]*)\/>/g)].map(
    ([, id, attrs]) => ({
      id: id!,
      group: /name="([^"]+)"/.exec(attrs!)?.[1],
      checked: /checked=""/.test(attrs!),
      disabled: /disabled=""/.test(attrs!),
      label: /aria-label="([^"]+)"/.exec(attrs!)?.[1],
    }),
  );

test('the rail is 320px, held to 280 to 440, and this browser keeps it with its collapsed state', () => {
  assert.deepEqual([RAIL.initial, RAIL.min, RAIL.max], [320, 280, 440]);
  assert.equal(railWidth(100), 280);
  assert.equal(railWidth(1000), 440);
  assert.equal(railWidth(333.6), 334);
  assert.equal(railWidth('wide'), 320);
  assert.equal(railWidth(Number.NaN), 320);
  const store = (text: string | null) => ({
    getItem: (key: string) => (key === RAIL_KEY ? text : null),
  });
  assert.deepEqual(readRail(store(JSON.stringify({ width: 400, collapsed: true }))), {
    width: 400,
    collapsed: true,
  });
  assert.deepEqual(readRail(store('{not json')), { width: 320, collapsed: false });
  assert.deepEqual(readRail(store(null)), { width: 320, collapsed: false });
  assert.deepEqual(readRail(null), { width: 320, collapsed: false });
  // A layout preference, never content: no demo or journal key.
  assert.doesNotMatch(RAIL_KEY, /^portfolio-(?:demo|studio):/);
});

test("the rail's separator moves by arrows, and Home and End go to its ends", () => {
  assert.equal(railKey(320, 'ArrowRight'), 336);
  assert.equal(railKey(320, 'ArrowLeft'), 304);
  assert.equal(railKey(436, 'ArrowRight'), 440);
  assert.equal(railKey(320, 'Home'), 280);
  assert.equal(railKey(320, 'End'), 440);
  assert.equal(railKey(320, 'a'), null);
});

test('the sheet snaps at about 25, 50, and 90%, starts at half, and its content drags it only from the top', () => {
  // It rests at 45%, so the preview keeps the top 55% (the design director's ST-S5).
  assert.deepEqual([...SHEET_SNAPS], [0.25, 0.45, 0.9]);
  assert.equal(SHEET_SNAPS[INITIAL_SNAP], 0.45);
  assert.equal(nearestSnap(0.1), 0);
  assert.equal(nearestSnap(0.4), 1);
  assert.equal(nearestSnap(0.65), 1);
  assert.equal(nearestSnap(0.8), 2);
  // Scrolled down, the content scrolls; at the top, a pull down moves the sheet, and a push up while it can still open.
  assert.equal(contentDrags(40, 30, 1), false);
  assert.equal(contentDrags(0, 30, 2), true);
  assert.equal(contentDrags(0, -30, 1), true);
  assert.equal(contentDrags(0, -30, 2), false);
});

test("an APG radio group's arrows move and wrap, skip disabled options, and Home and End go to the ends", () => {
  const options = [{}, { disabled: true }, {}, {}];
  assert.equal(nextChoice(options, 0, 'ArrowRight'), 2, 'skips the disabled one');
  assert.equal(nextChoice(options, 3, 'ArrowDown'), 0, 'wraps forward');
  assert.equal(nextChoice(options, 0, 'ArrowLeft'), 3, 'wraps back');
  assert.equal(nextChoice(options, 2, 'ArrowUp'), 0);
  assert.equal(nextChoice(options, 2, 'Home'), 0);
  assert.equal(nextChoice(options, 0, 'End'), 3);
  assert.equal(nextChoice(options, 0, 'Tab'), null);
  assert.equal(nextChoice([], 0, 'ArrowRight'), null);
});

test('a radio group has one Tab stop, the checked option, and each option says whether it is checked', () => {
  const html = renderToStaticMarkup(
    <RadioChoices
      label="Composition"
      value="b"
      onChange={() => {}}
      options={[
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C', disabled: true },
      ]}
    />,
  );
  assert.match(html, /^<div role="radiogroup" class="studio-choices" aria-label="Composition">/);
  // Native radios in their labels: the browser gives the checked one the group's one Tab stop.
  const radios = radiosIn(html);
  assert.equal(new Set(radios.map(({ group }) => group)).size, 1, 'one name for the group');
  assert.deepEqual(
    radios.map(({ id, checked, disabled }) => [id, checked, disabled]),
    [
      ['a', false, false],
      ['b', true, false],
      ['c', false, true],
    ],
  );
  // Each instance names its own group, so two pickers of one axis never join (round 1's bug).
  const two = renderToStaticMarkup(
    <>
      <RadioChoices label="A" value="a" onChange={() => {}} options={[{ id: 'a', label: 'A' }]} />
      <RadioChoices label="B" value="a" onChange={() => {}} options={[{ id: 'a', label: 'A' }]} />
    </>,
  );
  const names = [...two.matchAll(/name="([^"]+)"/g)].map(([, each]) => each);
  assert.equal(new Set(names).size, 2);
});

test('the workspace is the top bar, the rail, its separator, the preview with its bar over the frame, then the bottom bar', () => {
  const html = renderToStaticMarkup(
    <StudioSplit
      brand={<p className="brand">Portfolio Studio</p>}
      bar={<p className="source">Sample portfolio</p>}
      barEnd={<button type="button">Share</button>}
      form={{ label: 'Appearance', onSubmit: () => {} }}
      sections={[
        {
          id: 'variant',
          label: 'Composition',
          count: 5,
          description: 'Layout, navigation and component design',
          tools: <span className="tools-head" />,
          content: <p className="axis">thumbs</p>,
        },
        { id: 'colorScheme', label: 'Color scheme', content: <p className="axis">chips</p> },
      ]}
      railFooter={<button type="submit">Save draft</button>}
      railBar={<button type="button">Reset demo</button>}
      status={<p className="status">Color scheme is now Arctic Aurora.</p>}
      previewHeading="Preview of the saved draft"
      toolbar={{ start: <div className="widths" />, end: <div className="motion" /> }}
      frameWidth={1072}
      stage={<iframe title="Frame" />}
    />,
  );
  assert.match(
    html,
    /^<div class="studio-split" data-rail="open" style="--studio-rail:20rem;--studio-sheet:0.45;--studio-frame-width:1072px">/,
  );
  // The top bar: the rail zone, then the stage zone and its end.
  assert.match(
    html,
    /<div class="studio-split__top"><div class="studio-split__top-rail"><p class="brand">/,
  );
  assert.match(
    html,
    /<div class="studio-split__top-stage"><p class="source">Sample portfolio<\/p><div class="studio-split__top-end">/,
  );
  // The rail is the owner's form, its axes an index, one open at a time (the round 5b
  // mockups, ruling Q5): each row a head with its axis and a count, opening its panel under it,
  // the panel's line and tools, then its body.
  // A scroll region the keyboard reaches, named by the form's label.
  assert.match(
    html,
    /<form id="[^"]+" class="studio-split__rail" aria-label="Appearance" tabindex="0">/,
  );
  assert.match(
    html,
    /<details class="studio-split__fold" name="([^"]+)" open=""><summary class="studio-split__section-top"><span class="studio-split__look-blank" aria-hidden="true"><\/span><span class="studio-split__look-text"><h3 id="[^"]+" class="studio-split__section-head"><span class="studio-split__section-title"><span class="studio-split__look-axis">Composition<\/span><span class="studio-split__look-short" aria-hidden="true">Composition<\/span><\/span><span class="studio-split__count">5<\/span><\/h3><\/span><svg[^>]*class="studio-icon studio-split__fold-chevron"[\s\S]*?<\/summary><div class="studio-split__panel"><div class="studio-split__panel-head"><p class="studio-split__description">Layout, navigation and component design<\/p><div class="studio-split__section-tools"><span class="tools-head"><\/span><\/div><\/div><div class="studio-split__fold-body"><p class="axis">thumbs<\/p>[\s\S]*<details class="studio-split__fold" name="\1"><summary/,
  );
  assert.match(
    html,
    /role="separator" aria-orientation="vertical" aria-label="Controls width" aria-controls="[^"]+" aria-valuemin="280" aria-valuemax="440" aria-valuenow="320" tabindex="0"/,
  );
  assert.match(
    html,
    /<button type="button" class="studio-iconbutton studio-split__collapse" aria-expanded="true"/,
  );
  // The preview is named and is the room a contained frame fits, its bar over the frame in three zones.
  assert.match(
    html,
    /<section class="studio-split__preview" aria-labelledby="([^"]+)" data-fit-room="true"><h2 id="\1"/,
  );
  assert.match(
    html,
    /<div class="studio-split__tools" role="group" aria-label="Preview controls"><div class="studio-split__tools-start"><div class="widths"><\/div><\/div><div class="studio-split__tools-center"><\/div><div class="studio-split__tools-end"><div class="motion">/,
  );
  // Tab order is the markup's: the top bar, the rail, the separator, the bar over the frame, the frame, the bottom bar.
  const order = [
    'class="brand"',
    'class="source"',
    '>Share<',
    'class="axis"',
    '>Save draft<',
    'role="separator"',
    'class="widths"',
    '<iframe',
    '>Reset demo<',
    'class="status"',
  ];
  const at = order.map((each) => html.indexOf(each));
  assert.ok(
    at.every((each) => each >= 0),
    JSON.stringify(at),
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
  // Never separate Controls and Preview tabs.
  assert.doesNotMatch(html, />Controls<\/button>|>Preview<\/button>/);
});

test("a rail of its own content keeps the sections' look bar above it, wide, and no accordion or tabs (DEM-1)", () => {
  const html = renderToStaticMarkup(
    <StudioSplit
      brand={<p className="brand">Portfolio Studio</p>}
      railLabel="Export and import"
      sections={[
        {
          id: 'variant',
          label: 'Composition',
          look: { specimen: <i />, name: 'Editorial Evidence', step: () => {} },
          content: <p className="axis">thumbs</p>,
        },
        {
          id: 'colorScheme',
          label: 'Color scheme',
          look: { specimen: <i />, name: 'Warm Parchment' },
          content: <p className="axis">chips</p>,
        },
      ]}
      railContent={<p className="panel">Export setup</p>}
      onLookOpen={() => {}}
      previewHeading="Preview"
      toolbar={{ start: <div className="widths" /> }}
      stage={<iframe title="Frame" />}
    />,
  );
  assert.match(
    html,
    /<div id="[^"]+" class="studio-split__rail" role="region" aria-label="Export and import" tabindex="0">/,
  );
  // The look bar first, a row an axis, then the rail's own content.
  assert.match(
    html,
    /<div class="studio-split__look" role="group" aria-label="The current look">[\s\S]*data-look="variant"[\s\S]*data-look="colorScheme"[\s\S]*<\/div><div class="studio-split__content"><p class="panel">Export setup<\/p><\/div>/,
  );
  // No axis's own controls: no fold, no tab, no section.
  assert.doesNotMatch(html, /studio-split__fold|role="tablist"|class="axis"|data-section=/);
});

test('the device widths are a radio group of the true widths, each with its device, and the scale shows as a percentage', () => {
  const html = renderToStaticMarkup(<DeviceWidths value="tablet" onChange={() => {}} />);
  assert.match(
    html,
    /role="radiogroup" class="studio-choices studio-segmented studio-split__widths" aria-label="Device width"/,
  );
  const shown = [...html.matchAll(/class="studio-split__width-label">(\d+)</g)].map(
    ([, width]) => width,
  );
  const widths = radiosIn(html).map(({ id, checked, label }, at) => [
    id,
    String(checked),
    label,
    shown[at],
  ]);
  assert.deepEqual(widths, [
    ['desktop', 'false', 'Desktop 1440 by 900', '1440'],
    ['tablet', 'true', 'Tablet 1024 by 768', '1024'],
    ['mobile', 'false', 'Mobile 390 by 844', '390'],
  ]);
  assert.match(
    renderToStaticMarkup(<ScaleBadge scale={0.7333} />),
    /<span class="studio-split__scale"><span class="studio-split__scale-name">Shown at <\/span>73%<\/span>/,
  );
});

test('undo and redo show their real disabled states and their shortcuts, and Studio names itself once', () => {
  const html = renderToStaticMarkup(
    <HistoryButtons canUndo canRedo={false} onUndo={() => {}} onRedo={() => {}} shortcut="⌘Z" />,
  );
  assert.match(html, /aria-label="Undo" aria-keyshortcuts="Meta\+Z" title="Undo">/);
  assert.match(
    html,
    /aria-label="Redo" aria-keyshortcuts="Meta\+Shift\+Z" title="Redo" disabled="">/,
  );
  assert.match(
    renderToStaticMarkup(<StudioMark tag="Demo" />),
    /<h1 class="studio-mark__name"><span class="studio-mark__first">Portfolio <\/span>Studio<\/h1><span class="studio-mark__tag">Demo<\/span>/,
  );
});

test("the fit's reserve reads in pixels whatever unit it's written in, so the frame never runs under the bottom bar", () => {
  assert.equal(cssLength('2.75rem', 16, 14), 44);
  assert.equal(cssLength(' 2.75rem', 32, 14), 88, 'at 200% text');
  assert.equal(cssLength('2em', 16, 14), 28);
  assert.equal(cssLength('40px', 16, 14), 40);
  assert.equal(cssLength('0px', 16, 14), 0);
  assert.equal(cssLength('', 16, 14), 0);
});

/**
 * Where the option lands once the body scrolls to `target`, against what covers the body's
 * top: the sticky picker top (at its offset from the padding edge) and the head stuck under
 * it, which sticks at the line the top covers to, its margin no part of where it sticks (the
 * browser's own numbers in run-14). Whole: wholly below that stack and inside the room.
 */
function lands(geometry: RevealGeometry, target: number) {
  const { padding, top, head, option, room } = geometry;
  const cover = top ? padding + top.offset + top.height : 0;
  const headAt = head ? Math.max(cover, head.y - target) : cover;
  const stack = head && head.y - target <= cover ? cover + head.height : Math.max(cover, 0);
  const at = option.y - target;
  return {
    at,
    stack,
    whole: at >= stack - 0.5 && at >= headAt && at + option.height <= room + 0.5,
  };
}

/** The same panel as before ae36d7877 read it: the sticky top's padding edge left out. */
const before = (geometry: RevealGeometry): RevealGeometry => ({ ...geometry, padding: 0 });

test('a panel opens on its checked option whole, under the sticky top and its stuck head, as each panel shape measured in the browser (P1-3)', () => {
  // Style at 1280x720 (run-14): a 97px search and chips top, the list head "Quiet 9 of 33" (18px,
  // its 0.5rem margin above it then), and Platform Neutral 4th of 9, 48px, at 273.
  const style: RevealGeometry = {
    room: 295,
    padding: 8,
    top: { offset: -8, height: 97 },
    head: { y: 105, height: 18 },
    option: { y: 273, height: 48 },
  };
  // Color at 1280x720 (run-15): a 131px search, chips and toggle top, the list head "Earthy 8
  // of 31" (26px with its padding), and Warm Parchment in the last row, 88px, at 380.
  const color: RevealGeometry = {
    room: 302,
    padding: 8,
    top: { offset: -8, height: 131 },
    head: { y: 131, height: 26 },
    option: { y: 380, height: 88 },
  };
  for (const [name, geometry, scrolled] of [
    ['Style', style, 162],
    ['Color', color, 226],
  ] as const) {
    const target = revealTarget(geometry);
    const now = lands(geometry, target);
    assert.ok(now.whole, `${name}: lands at ${now.at}, under a stack to ${now.stack}`);
    // Replayed as before: the scroll the browser reported, and the option sliced by the stack.
    const old = revealTarget(before(geometry));
    assert.ok(Math.abs(old - scrolled) <= 1, `${name}: ${old} replays the run's ${scrolled}`);
    assert.equal(lands(geometry, old).whole, false, `${name}: sliced before ae36d7877`);
  }
  // Type at 1280x720 (rail-1280x720.png): it opens at its top whatever is checked, its web fonts'
  // head under the chips, and its first picture row whole.
  const type: RevealGeometry = {
    room: 297,
    padding: 8,
    top: { offset: -8, height: 50 },
    head: { y: 50, height: 52 },
    option: { y: 560, height: 50 },
    openAtTop: true,
  };
  assert.equal(revealTarget(type), 0);
  const pictures = { ...type, option: { y: 102, height: 50 } };
  assert.ok(lands(pictures, revealTarget(type)).whole, 'the first web font row whole');
  // A checked one that shows from the top doesn't move the panel; one with no head lands at
  // its own row's top under the sticky top.
  assert.equal(revealTarget({ ...style, option: { y: 150, height: 48 } }), 0);
  const headless: RevealGeometry = {
    room: 200,
    padding: 8,
    top: { offset: -8, height: 60 },
    option: { y: 400, height: 80 },
  };
  const target = revealTarget(headless);
  assert.ok(lands(headless, target).whole, `no head: ${target}`);
});

test("a checked option in a group's last row still comes up whole under its stuck head, the row above it wholly hidden, with room added under the body's end (P1-A)", () => {
  // Color at 1440x780 (rail-1440x780-schemes.png): a 127px top, "Earthy 8 of 31" (24px), three
  // rows of tiles, 106px with their names (Low Stimulus Warm's two lines and its Accessible
  // tag), 8px apart, Warm Parchment in the last, then About: the body's scroll ends at 163.
  const color: RevealGeometry = {
    room: 360,
    padding: 8,
    top: { offset: -8, height: 127 },
    head: { y: 127, height: 24 },
    option: { y: 379, height: 90 },
  };
  const above = { y: 265, height: 106 };
  const max = 163;
  const target = revealTarget(color);
  // The scroll the body can reach, alone, leaves the row above showing its names, its swatches
  // under the head: what the review saw.
  const reached = Math.min(target, max);
  const stack = 127 + 24;
  assert.ok(above.y + above.height - reached > stack + 1, 'the row above shows under the head');
  // With the room it needs, the option lands whole, just under the head, and the row above
  // goes wholly under it.
  assert.equal(revealRoom(target, max), target - max);
  assert.ok(revealRoom(target, max) > 0);
  const now = lands(color, target);
  assert.ok(now.whole, `lands at ${now.at} under ${now.stack}`);
  assert.ok(above.y + above.height - target <= stack, 'the row above wholly hidden');
  // None is added while the body's own scroll reaches the option.
  assert.equal(revealRoom(120, max), 0);
});

test("the wide rail stays pinned only while the open panel shows its checked option whole under its head, with its ring's room, so Owner's Composition at 1440x900 scrolls as one (the Studio quality cells' focus perimeter)", () => {
  const min = 96;
  const ring = 8;
  // Owner at 1440x900 (the 059b4d7af quality run): a 125px drawing under "Ready 10" and its
  // line (about 43px) needs 185px, where the pinned body left about 112px under its chips.
  const composition = panelRoom({ min, head: 43, option: 125.25, ring });
  assert.equal(composition, 185);
  assert.ok(composition > 112, 'too tall for the pinned body: the rail scrolls as one');
  // A scheme tile (88px under a 24px head) needs 128px, a type row (48px under 18px) 6rem.
  assert.equal(panelRoom({ min, head: 24, option: 88, ring }), 128);
  assert.equal(panelRoom({ min, head: 18, option: 48, ring }), min);
  // A panel with nothing checked keeps the 6rem floor.
  assert.equal(panelRoom({ min, head: 0, option: 0, ring }), min);
});
