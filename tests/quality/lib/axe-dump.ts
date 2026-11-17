// Evidence only, never merged: what the page held for each color-contrast node axe left incomplete,
// read the moment axe returned, one JSON file a call in QUALITY_AXE_DUMP's folder. For each node:
// its rule, message key and related nodes; its box; its text nodes' client rects; the rects axe
// reads itself (axe.commons.dom.getVisibleChildTextRects) and the stack axe builds at each
// (getTextElementStack); the top of elementsFromPoint at each text rect's center and at the box's
// center; every ancestor whose overflow isn't visible, with its overflow and box; every ancestor
// with a transform, and the animations on it; and each related node's box. And the page's time,
// scroll and :hover chain, and every animation's time and the clock both just before axe ran
// (axeClock()) and as it returned, with the run's length: axe keeps each element's box from its
// first read in a run, and reads text rects live, so what moves in between moves under it.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { AxeResults } from './records';

/** The parts of the page's axe the dump reads. */
interface AxeInPage {
  readonly setup?: (node: Node) => unknown;
  readonly teardown?: () => void;
  readonly commons: {
    readonly dom: {
      readonly getVisibleChildTextRects: (el: Element) => DOMRect[];
      readonly getTextElementStack: (el: Element) => Element[][];
    };
  };
}

/** The page's clock, its :hover chain and every animation's time, as axeClock() reads them. */
export interface AxeClock {
  readonly now: number;
  readonly hover: readonly string[];
  readonly animations: readonly {
    readonly name: string | null;
    readonly target: string | null;
    readonly time: number | null;
    readonly state: string;
    readonly rate: number;
  }[];
}

/** The page's clock, its :hover chain, and every animation's time and state, read now. */
export function axeClock(page: Page): Promise<AxeClock | null> {
  return page
    .evaluate(() => ({
      now: Math.round(performance.now()),
      hover: [...document.querySelectorAll(':hover')].map(
        (each) =>
          `${each.localName}${[...each.classList]
            .slice(0, 2)
            .map((c) => `.${c}`)
            .join('')}`,
      ),
      animations: document.getAnimations().map((each) => {
        const target = (each.effect as KeyframeEffect | null)?.target ?? null;
        return {
          name: (each as CSSAnimation).animationName ?? null,
          target: target
            ? `${target.localName}${[...target.classList]
                .slice(0, 2)
                .map((c) => `.${c}`)
                .join('')}`
            : null,
          time: each.currentTime === null ? null : Math.round(Number(each.currentTime)),
          state: each.playState,
          rate: each.playbackRate,
        };
      }),
    }))
    .catch(() => null);
}

interface DumpNode {
  readonly rule: string;
  readonly target: string;
  readonly checks: readonly { readonly data: unknown; readonly related: readonly string[] }[];
}

export async function dumpAxeIncomplete(
  page: Page,
  results: Pick<AxeResults, 'incomplete'>,
  dir: string,
  label: string,
  before: AxeClock | null = null,
): Promise<void> {
  const nodes: DumpNode[] = results.incomplete
    .filter((rule) => rule.id === 'color-contrast' || rule.id === 'color-contrast-enhanced')
    .flatMap((rule) =>
      rule.nodes
        .filter((node) => typeof node.target[0] === 'string')
        .map((node) => ({
          rule: rule.id,
          target: node.target[0] as string,
          checks: node.any.map((check) => ({
            data: check.data as unknown,
            related: (check.relatedNodes ?? [])
              .map((each) => each.target[0])
              .filter((each): each is string => typeof each === 'string'),
          })),
        })),
    );
  if (nodes.length === 0) return;
  const after = await axeClock(page);
  const read = await page
    .evaluate((nodes: DumpNode[]) => {
      const box = (r: DOMRect | DOMRectReadOnly) => ({
        left: Math.round(r.left * 10) / 10,
        top: Math.round(r.top * 10) / 10,
        right: Math.round(r.right * 10) / 10,
        bottom: Math.round(r.bottom * 10) / 10,
      });
      const named = (el: Element | null) =>
        el
          ? `${el.localName}${el.id ? `#${el.id}` : ''}${[...el.classList]
              .slice(0, 3)
              .map((c) => `.${c}`)
              .join('')}`
          : null;
      const at = (x: number, y: number) =>
        document
          .elementsFromPoint(x, y)
          .slice(0, 4)
          .map((each) => named(each));
      const center = (r: { left: number; top: number; right: number; bottom: number }) => ({
        x: (r.left + r.right) / 2,
        y: (r.top + r.bottom) / 2,
      });
      const axe = (window as unknown as { axe?: AxeInPage }).axe;
      return {
        now: Math.round(performance.now()),
        scroll: [scrollX, scrollY],
        hover: [...document.querySelectorAll(':hover')].map((each) => named(each)),
        nodes: nodes.map((node) => {
          const el = document.querySelector(node.target);
          if (!el) return { ...node, found: false };
          const r = el.getBoundingClientRect();
          const texts = [...el.childNodes]
            .filter((each) => each.nodeType === Node.TEXT_NODE && each.textContent?.trim())
            .map((each) => {
              const range = document.createRange();
              range.selectNodeContents(each);
              return [...range.getClientRects()].map((rect) => {
                const b = box(rect);
                const c = center(b);
                return { ...b, at: at(c.x, c.y) };
              });
            });
          let axeRects: unknown = 'no axe';
          let axeStacks: unknown = 'no axe';
          if (axe?.setup) {
            try {
              axe.setup(document);
              const rects = axe.commons.dom.getVisibleChildTextRects(el);
              axeRects = rects.map((rect) => {
                const b = box(rect);
                const c = center(b);
                return { ...b, at: at(c.x, c.y) };
              });
              axeStacks = axe.commons.dom
                .getTextElementStack(el)
                .map((stack) => stack.slice(0, 6).map((each) => named(each)));
            } catch (error) {
              axeRects = `axe threw: ${String(error).slice(0, 200)}`;
            } finally {
              try {
                axe.teardown?.();
              } catch {
                // nothing more to read
              }
            }
          }
          const clips: unknown[] = [];
          const turns: unknown[] = [];
          for (let up = el.parentElement; up; up = up.parentElement) {
            const s = getComputedStyle(up);
            if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible')
              clips.push({
                el: named(up),
                overflow: s.overflow,
                x: s.overflowX,
                y: s.overflowY,
                box: box(up.getBoundingClientRect()),
              });
            if (s.transform !== 'none')
              turns.push({
                el: named(up),
                transform: s.transform,
                box: box(up.getBoundingClientRect()),
                animations: up.getAnimations().map((each) => ({
                  name: (each as CSSAnimation).animationName ?? null,
                  state: each.playState,
                  time: each.currentTime === null ? null : Math.round(Number(each.currentTime)),
                  rate: each.playbackRate,
                })),
              });
          }
          const c = center(box(r));
          return {
            ...node,
            found: true,
            el: named(el),
            box: box(r),
            boxCenterAt: at(c.x, c.y),
            texts,
            axeRects,
            axeStacks,
            clips,
            turns,
            related: node.checks.flatMap((check) =>
              check.related.map((selector) => {
                const each = document.querySelector(selector);
                return { selector, box: each ? box(each.getBoundingClientRect()) : null };
              }),
            ),
          };
        }),
      };
    }, nodes)
    .catch((error: unknown) => ({ failed: String(error).slice(0, 400) }));
  mkdirSync(dir, { recursive: true });
  const ran = before && after ? after.now - before.now : null;
  writeFileSync(
    path.join(dir, `${label}-${Date.now()}-${randomBytes(3).toString('hex')}.json`),
    `${JSON.stringify({ before, after, ran, read }, null, 2)}\n`,
  );
}
