// The keyboard, focus, occlusion, overlay, and hover checks (#11, Slice 2,
// items 2, 3, 4, and 7), each on the page as it stands. A finding names the
// gate and rule of part A's EXCEPTION_GATES (tests/quality/lib/exceptions.ts)
// and the element by its CSS path, which run-cell.ts turns into a failure
// record with the element's role and name.
//
// - keyboard: Tab from the top until focus leaves the page. Every control
//   is reached once (reachable), focus never loops short of the end (trap),
//   and each stop is shown in the viewport while it has focus
//   (hidden-focusable), so the skip link passes and a pixel-clipped link
//   fails.
// - focus: at each stop, the focused clip (4 px around the control) against
//   the blurred one. Some pixel changes (visible), some by 3:1 (contrast),
//   and the 3:1 change covers the area of a 2 px ring round the control
//   (perimeter), as quality/thresholds.json sets them.
// - occlusion: at each stop, the point at its center hits it, a descendant,
//   or its label (2.4.11).
// - overlays: each control that opens a dialog or menu, from the keyboard.
//   Focus moves in and Tab keeps it in (containment), Escape closes it
//   (escape), focus goes back to the control (focus-return), and
//   aria-expanded follows (state). A registered dialog or disclosure must
//   be on its route under its name.
// - hover: what hovering a :hover rule's subject shows, focusing it (or
//   clicking it, without the pointer, when nothing there takes focus) shows
//   too (parity), and nothing visible says what it says only in title
//   (title-only).

import type { Page } from '@playwright/test';
import { loadThresholds } from '../../../../quality/thresholds';
import type { Interaction } from '../registration';
import type { InputMode } from '../vocabulary';
import { contrast, decodePng, pixel } from '../pixels';
import { inPage, type Active, type Box } from './probe';

export interface Finding {
  /** The gate, as EXCEPTION_GATES names it: keyboard, focus, occlusion, hover, and so on. */
  readonly gate: string;
  readonly rule: string;
  /** The element, by CSS path. */
  readonly path?: string;
  readonly expected?: string;
  readonly actual?: string;
  /** Where it was found, when not at the cell's own viewport, such as 844x390 or 320x568. */
  readonly viewport?: string;
  readonly inputMode?: InputMode;
}

const thresholds = loadThresholds();
/** The clip's margin at least, past the box: the refined body's 4 px, more for a ring that reaches further. */
const MIN_MARGIN = 4;
/**
 * A ring drawn at a fractional position, or round a rounded corner,
 * antialiases its edge pixels under 3:1: a solid 2px ring measures 94% to
 * 99% of its area in Chromium. A 1px ring, at half, still fails.
 */
const EDGE_ALLOWANCE = 0.9;

/**
 * Two frames drawn, and `ms` more. With JavaScript off the page runs no
 * frame or timer callback, so it waits out the same time from here.
 */
export async function frames(page: Page, ms = 0): Promise<void> {
  if (await page.evaluate(() => matchMedia('(scripting: none)').matches)) {
    await page.waitForTimeout(ms + 50);
    return;
  }
  await page.evaluate(
    (wait) =>
      new Promise((done) =>
        // The motion sampler's original, when it's installed, so these frames aren't counted.
        (
          (window as unknown as { __qualityRaf?: typeof requestAnimationFrame }).__qualityRaf ??
          requestAnimationFrame
        )(() =>
          (
            (window as unknown as { __qualityRaf?: typeof requestAnimationFrame }).__qualityRaf ??
            requestAnimationFrame
          )(() => setTimeout(done, wait)),
        ),
      ),
    ms,
  );
}

/** `box` and `margin` round it, in whole pixels, cut to the viewport; null when none of it is in view. */
function clipAround(
  box: Box,
  margin: number,
  viewport: { width: number; height: number },
): Box | null {
  const x = Math.max(0, Math.floor(box.x - margin));
  const y = Math.max(0, Math.floor(box.y - margin));
  const width = Math.min(viewport.width, Math.ceil(box.x + box.width + margin)) - x;
  const height = Math.min(viewport.height, Math.ceil(box.y + box.height + margin)) - y;
  return width >= 1 && height >= 1 ? { x, y, width, height } : null;
}

/**
 * The length of a 1px ring round `box`, counting only the sides whose
 * margin is in the viewport: an indicator past the edge can't be seen or
 * measured there.
 */
function ringLength(box: Box, margin: number, viewport: { width: number; height: number }): number {
  const width = Math.min(box.width, viewport.width);
  const height = Math.min(box.height, viewport.height);
  return (
    (box.y - margin >= 0 ? width : 0) +
    (box.y + box.height + margin <= viewport.height ? width : 0) +
    (box.x - margin >= 0 ? height : 0) +
    (box.x + box.width + margin <= viewport.width ? height : 0)
  );
}

/** The focus check on the stop that has focus. It leaves focus where it found it. */
export async function focusFindings(page: Page, active: Active): Promise<Finding[]> {
  const viewport = page.viewportSize()!;
  // As far as the indicator reaches, from its outline or box-shadow, and a pixel more.
  const margin = Math.max(MIN_MARGIN, Math.ceil(active.reach) + 1);
  const clip = clipAround(active.box, margin, viewport);
  if (!clip) return [];
  const shot = () => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  const focused = decodePng(await shot());
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const blurred = decodePng(await shot());
  await page.evaluate(
    (path) => (document.querySelector(path) as HTMLElement | null)?.focus(),
    active.path,
  );
  let changed = 0;
  let strong = 0;
  for (let i = 0; i < focused.width * focused.height; i++) {
    const [a, b] = [pixel(focused, i), pixel(blurred, i)];
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
    changed++;
    if (contrast(a, b) >= thresholds.contrast.nonText) strong++;
  }
  const ring = ringLength(active.box, margin, viewport) * (focused.width / clip.width) ** 2;
  const need = Math.round(ring * thresholds.focus.perimeterPx);
  const base = { gate: 'focus', path: active.path };
  if (changed === 0) {
    return [
      {
        ...base,
        rule: 'visible',
        expected: 'focus changes how it looks',
        actual: 'no pixel changes when it takes focus',
      },
    ];
  }
  if (strong < ring) {
    return [
      {
        ...base,
        rule: 'contrast',
        expected: `the change reaches ${thresholds.contrast.nonText}:1 over a 1px ring`,
        actual: `${strong} of ${changed} changed pixels reach ${thresholds.contrast.nonText}:1, under the ${Math.round(ring)} a 1px ring needs`,
      },
    ];
  }
  if (strong < need * EDGE_ALLOWANCE) {
    return [
      {
        ...base,
        rule: 'perimeter',
        expected: `${need} pixels at ${thresholds.contrast.nonText}:1, a ${thresholds.focus.perimeterPx}px ring`,
        actual: `${strong}`,
      },
    ];
  }
  return [];
}

export interface KeyboardOptions {
  /** Diff each stop's focused and blurred clip. */
  readonly focus?: boolean;
  /** Hit-test each stop's center. */
  readonly occlusion?: boolean;
}

/** The keyboard walk, with the focus and occlusion checks at each stop as asked. */
export async function keyboardFindings(
  page: Page,
  options: KeyboardOptions = {},
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const tabbables = await inPage<string[]>(page, { kind: 'tabbables' });
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  // Occluders count even with pointer-events: none: the probe walks the
  // paint stack, which forced pointer events put them in.
  if (options.occlusion) {
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.dataset.qualityPointer = '';
      style.textContent = '*, *::before, *::after { pointer-events: auto !important; }';
      document.head.append(style);
    });
  }
  const stops: Active[] = [];
  let ended = false;
  for (let press = 0; press < tabbables.length * 2 + 10; press++) {
    await page.keyboard.press('Tab');
    // Frames for what focus scrolls to, and for what that scroll shows, such as a footer.
    if (options.occlusion) await frames(page, 50);
    const active = await inPage<Active>(page, { kind: 'active' });
    // Past the last control, focus leaves for the document before it wraps.
    if (active.none) {
      ended = true;
      break;
    }
    if (stops.some((stop) => stop.path === active.path)) {
      findings.push({
        gate: 'keyboard',
        rule: 'trap',
        path: active.path,
        expected: 'Tab moves on until focus leaves the page',
        actual: `focus came back to it after ${stops.length} stops, short of the end`,
      });
      ended = true;
      break;
    }
    stops.push(active);
    if (!active.shown || !active.inView) {
      findings.push({
        gate: 'keyboard',
        rule: 'hidden-focusable',
        path: active.path,
        expected: 'shown in the viewport while it has focus',
        actual: active.shown
          ? 'it has focus outside the viewport'
          : 'it has focus while hidden, transparent, or a pixel or less',
      });
      continue;
    }
    if (options.occlusion && !active.hitsItself) {
      findings.push({
        gate: 'occlusion',
        rule: 'obscured',
        path: active.path,
        expected: 'the point at its center hits it',
        actual: `${active.hit || 'nothing'} is there`,
      });
    }
    if (options.focus) findings.push(...(await focusFindings(page, active)));
  }
  await page.evaluate(() => document.querySelector('style[data-quality-pointer]')?.remove());
  if (!ended) {
    findings.push({
      gate: 'keyboard',
      rule: 'trap',
      path: stops.at(-1)?.path,
      expected: 'Tab moves on until focus leaves the page',
      actual: `focus never left after ${stops.length} stops`,
    });
  }
  const reached = new Set(stops.map((stop) => stop.path));
  for (const path of ended ? tabbables.filter((each) => !reached.has(each)) : []) {
    findings.push({
      gate: 'keyboard',
      rule: 'reachable',
      path,
      expected: 'Tab reaches it',
      actual: 'Tab never reached it',
    });
  }
  return findings;
}

interface Containment {
  readonly open: boolean;
  readonly inside: boolean;
  readonly none: boolean;
  readonly count: number;
}

/** Controls that open something, checked in a page; more fail closed as unchecked. */
const TRIGGER_LIMIT = 20;
/** How long an overlay may take to open. */
const OPEN_WAIT_MS = 1_000;

/** The overlay check on each control that opens one, and on the route's registered dialogs and disclosures. */
export async function overlayFindings(
  page: Page,
  interactions: readonly Interaction[],
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const triggers = await inPage<{ path: string; name: string }[]>(page, { kind: 'triggers' });
  for (const interaction of interactions.filter(
    (each) => each.kind === 'dialog' || each.kind === 'disclosure',
  )) {
    const found = await inPage<{
      path: string;
      tag: string;
      expanded: string | null;
      pressed: string | null;
    } | null>(page, { kind: 'named', name: interaction.name });
    if (!found) {
      findings.push({
        gate: 'keyboard',
        rule: 'reachable',
        expected: `the registered ${interaction.kind} ${interaction.name}`,
        actual: 'no control on the page has that name',
      });
    } else if (
      interaction.kind === 'disclosure' &&
      found.tag !== 'summary' &&
      found.expanded === null &&
      found.pressed === null
    ) {
      findings.push({
        gate: 'keyboard',
        rule: 'state',
        path: found.path,
        expected: 'aria-expanded or aria-pressed says whether it shows',
        actual: 'neither is set',
      });
    } else if (!triggers.some((each) => each.path === found.path)) {
      triggers.push({ path: found.path, name: interaction.name });
    }
  }
  if (triggers.length > TRIGGER_LIMIT) {
    findings.push({
      gate: 'runner',
      rule: 'coverage',
      expected: `at most ${TRIGGER_LIMIT} controls that open something, each checked`,
      actual: `${triggers.length} on the page, so ${triggers.length - TRIGGER_LIMIT} went unchecked`,
    });
  }
  for (const trigger of triggers.slice(0, TRIGGER_LIMIT)) {
    const before = new Set(
      (await inPage<{ path: string }[]>(page, { kind: 'overlays' })).map((each) => each.path),
    );
    // A key first, so the focus that follows counts as the keyboard's.
    await page.keyboard.press('Shift+Tab');
    await page.evaluate(
      (path) => (document.querySelector(path) as HTMLElement | null)?.focus(),
      trigger.path,
    );
    const expanded = await inPage<string | null>(page, { kind: 'expanded', path: trigger.path });
    await page.keyboard.press('Enter');
    // Up to a second for an overlay to open, or the control to say it changed.
    for (let waited = 0; waited < OPEN_WAIT_MS; waited += 100) {
      await frames(page, 100);
      const shownNow = await inPage<{ path: string }[]>(page, { kind: 'overlays' });
      if (shownNow.some((each) => !before.has(each.path))) break;
      if (
        (await inPage<string | null>(page, { kind: 'expanded', path: trigger.path })) !== expanded
      )
        break;
    }
    const opened = (
      await inPage<{ path: string; modal: boolean }[]>(page, { kind: 'overlays' })
    ).filter((each) => !before.has(each.path));
    const at = { gate: 'keyboard', path: trigger.path };
    if (opened.length === 0) {
      // A disclosure or a toggle: put it back.
      if (
        (await inPage<string | null>(page, { kind: 'expanded', path: trigger.path })) !== expanded
      )
        await page.keyboard.press('Enter');
      continue;
    }
    const overlay = opened[0]!;
    if (
      expanded !== null &&
      (await inPage(page, { kind: 'expanded', path: trigger.path })) !== 'true'
    ) {
      findings.push({
        ...at,
        rule: 'state',
        expected: 'aria-expanded is true while it shows',
        actual: `it stays ${expanded}`,
      });
    }
    let state = await inPage<Containment>(page, { kind: 'contains', container: overlay.path });
    if (!state.inside) {
      findings.push({
        ...at,
        rule: 'containment',
        expected: `focus moves into ${overlay.path} when it opens`,
        actual: 'focus stayed outside it',
      });
    } else {
      for (let press = 0; press < state.count + 2; press++) {
        await page.keyboard.press('Tab');
        state = await inPage<Containment>(page, { kind: 'contains', container: overlay.path });
        if (!state.open) break;
        // Out to the browser is no trap; onto the page behind an open overlay is a leak.
        if (!state.inside && !state.none) {
          findings.push({
            ...at,
            rule: 'containment',
            expected: `Tab keeps focus in ${overlay.path} while it's open`,
            actual: 'Tab took focus to the page behind it',
          });
          break;
        }
      }
    }
    if (state.open) {
      if (!state.inside)
        await page.evaluate(
          (path) => (document.querySelector(path) as HTMLElement | null)?.focus(),
          overlay.path,
        );
      await page.keyboard.press('Escape');
      await frames(page, 100);
      if ((await inPage<Containment>(page, { kind: 'contains', container: overlay.path })).open) {
        findings.push({
          ...at,
          rule: 'escape',
          expected: 'Escape closes it',
          actual: `${overlay.path} stays open`,
        });
        return findings;
      }
    }
    const active = await inPage<Active>(page, { kind: 'active' });
    if (active.path !== trigger.path) {
      findings.push({
        ...at,
        rule: 'focus-return',
        expected: 'focus goes back to the control that opened it',
        actual: active.none ? 'focus went to the page itself' : `focus went to ${active.path}`,
      });
    }
    if (
      expanded !== null &&
      (await inPage(page, { kind: 'expanded', path: trigger.path })) !== expanded
    ) {
      findings.push({
        ...at,
        rule: 'state',
        expected: `aria-expanded goes back to ${expanded} once it closes`,
        actual: 'it stays true',
      });
    }
  }
  return findings;
}

/** What hover reveals here stays out of view without it, and only transitions are stilled. */
const STILL = '*, *::before, *::after { transition: none !important; }';
/** :hover subjects checked in a page; more fail closed as unchecked. */
const HOVER_LIMIT = 40;
/** A popover such as #19's tooltip opens after 300 ms on hover. */
const HOVER_WAIT_MS = 350;

/** The hover check: parity for each :hover rule's subject, then title-only. */
export async function hoverFindings(page: Page, limit = HOVER_LIMIT): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { paths: targets, total } = await inPage<{ paths: string[]; total: number }>(page, {
    kind: 'hover-targets',
    limit,
  });
  if (total > limit) {
    findings.push({
      gate: 'runner',
      rule: 'coverage',
      expected: `at most ${limit} :hover subjects, each checked, those whose rule reveals something first`,
      actual: `${total} on the page, so ${total - limit} went unchecked`,
    });
  }
  await page.evaluate((css) => {
    const style = document.createElement('style');
    style.dataset.qualityStill = '';
    style.textContent = css;
    document.head.append(style);
  }, STILL);
  const shownNow = async () => new Set(await inPage<string[]>(page, { kind: 'shown' }));
  // What shows with the pointer at rest. A hover that revealed nothing
  // leaves it as it was, so it's read again only after one that did.
  let resting: Set<string> | null = null;
  for (const target of targets) {
    if (!resting) {
      await page.mouse.move(0, 0);
      await frames(page, HOVER_WAIT_MS);
      resting = await shownNow();
    }
    const at: Set<string> = resting;
    const box = await inPage<Box | null>(page, { kind: 'box', path: target });
    if (!box || box.width < 1 || box.height < 1) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await frames(page, HOVER_WAIT_MS);
    const revealed = [...(await shownNow())].filter((path) => !at.has(path));
    await page.mouse.move(0, 0);
    if (revealed.length === 0) continue;
    resting = null;
    await frames(page, HOVER_WAIT_MS);
    await page.keyboard.press('Shift+Tab');
    const how = await page.evaluate((path) => {
      const el = document.querySelector(path) as HTMLElement | null;
      const focusable =
        'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
      const to = el?.matches(focusable)
        ? el
        : (el?.querySelector<HTMLElement>(focusable) ?? el?.closest<HTMLElement>(focusable));
      if (to) {
        to.focus();
        return 'focus';
      }
      el?.click();
      return 'a tap';
    }, target);
    await frames(page, HOVER_WAIT_MS);
    const after = await shownNow();
    const missing = revealed.filter((path) => !after.has(path));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    if (missing.length > 0) {
      findings.push({
        gate: 'hover',
        rule: 'parity',
        path: target,
        expected: `${how} shows what hover shows`,
        actual: `hover shows ${missing.length} element(s) ${how} doesn't, the first ${missing[0]}`,
      });
    }
  }
  await page.evaluate(() => document.querySelector('style[data-quality-still]')?.remove());
  for (const { path, title } of await inPage<{ path: string; title: string }[]>(page, {
    kind: 'title-only',
  })) {
    findings.push({
      gate: 'hover',
      rule: 'title-only',
      path,
      expected: 'what its title says is in its name or text too',
      actual: `only its title says ${JSON.stringify(title)}`,
    });
  }
  return findings;
}
