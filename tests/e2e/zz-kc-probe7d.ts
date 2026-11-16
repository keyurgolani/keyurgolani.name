import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { ringFindingsOf } from './kinetic-cosmos-reading';
import { judgeTexts } from './zz-kc-probe7d-backplate';

// Scratch probe, never committed: a candidate platform fix for text that vanishes into its forced-
// colours backplate, injected unlayered (as the platform's own later layer would win): no text role
// maps to the backplate's colour (text-inverse and on-status to CanvasText, on-accent to ButtonText,
// on-emphasis to CanvasText), and the accent and emphasis surfaces keep a ring off their ground
// (ButtonFace, HighlightText). Against none: each text in the Canvas colour before, judged in
// pixels against its backplate; and the focus check on a focusable in each surface and on each
// text-holding control that was in the Canvas colour.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const log = (o: unknown) => console.log(`[kc-probe7d] ${JSON.stringify(o)}`);

export const P2 = `@media (forced-colors: active) {
  [data-appearance-boundary] { --color-text-inverse: CanvasText; --color-on-status: CanvasText; --color-on-accent: ButtonText; --color-on-emphasis: CanvasText; }
  [data-appearance-boundary] [data-ui-surface='accent'] { --color-focus: ButtonFace; }
  [data-appearance-boundary] [data-ui-surface='emphasis'] { --color-focus: HighlightText; }
}`;

export function optionsFor(id: string) {
  return {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), id),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  };
}

export const CASES = (['/', '/work/project-name'] as const).flatMap((route) =>
  (['light', 'dark'] as const).flatMap((scheme) =>
    [1024, 390].flatMap((width) =>
      (['none', 'p2'] as const).map((candidate) => ({ route, scheme, width, candidate })),
    ),
  ),
);

export async function check(
  page: Page,
  id: string,
  c: { route: string; scheme: 'light' | 'dark'; width: number; candidate: 'none' | 'p2' },
) {
  await page.setViewportSize({ width: c.width, height: c.width < 600 ? 844 : 768 });
  await page.emulateMedia({
    colorScheme: c.scheme,
    forcedColors: 'active',
    reducedMotion: 'reduce',
  });
  await page.goto(c.route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // Mark, before any change, each text in the Canvas colour and the focusables to ring.
  const marked = await page.evaluate(() => {
    const s = document.createElement('span');
    s.style.color = 'Canvas';
    document.body.append(s);
    const canvas = getComputedStyle(s).color;
    s.remove();
    let texts = 0;
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const controls = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim()) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (
        cs.color !== canvas ||
        cs.visibility !== 'visible' ||
        !el.getClientRects().length ||
        cs.forcedColorAdjust === 'none'
      )
        continue;
      el.setAttribute('data-forced-text', String(texts));
      texts += 1;
      const control = el.closest('a[href], button, summary');
      if (control) controls.add(control);
    }
    let rings = 0;
    const ring = (el: Element | null, why: string) => {
      if (!el || el.hasAttribute('data-p7-ring') || !el.getClientRects().length || rings >= 6)
        return;
      el.setAttribute('data-p7-ring', why);
      rings += 1;
    };
    for (const surface of ['inverse', 'accent', 'emphasis']) {
      ring(
        document.querySelector(
          `[data-ui-surface="${surface}"] :is(a[href], button, summary, select)`,
        ),
        surface,
      );
    }
    for (const el of [...controls].slice(0, 3)) ring(el, 'canvas-text control');
    return { texts, rings };
  });
  if (c.candidate === 'p2') await page.addStyleTag({ content: P2 });
  const judged = marked.texts ? await judgeTexts(page) : [];
  // A text that shows only on its control's focus (a label revealed by it) is judged focused.
  for (const [at, item] of judged.entries()) {
    if (item.ratio !== null) continue;
    const control = page
      .locator(`[data-forced-text="${item.mark}"]`)
      .locator('xpath=ancestor-or-self::*[self::a[@href] or self::button or self::summary][1]');
    if (!(await control.count())) continue;
    await control.first().focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const again = await judgeTexts(page, item.mark);
    const same = again.find((j) => j.mark === item.mark);
    if (same)
      judged[at] = {
        ...same,
        unjudged: same.ratio === null ? `${same.unjudged} (focused too)` : undefined,
        words: `${same.words} [on focus]`,
      };
  }
  const vanished = judged
    .filter((j) => j.ratio !== null && j.ratio < 4.5)
    .map((j) => `"${j.words}": ${j.ratio!.toFixed(2)}:1`);
  // Where each still-vanished text's colour comes from: the declared colour, traced through its
  // custom properties to a --color-* role (P2's map reaches it), a literal, or a composition-only
  // token that ends in one (a composition fix).
  const trace = (m: string) =>
    page.evaluate((mark) => {
      const el = document.querySelector(`[data-forced-text="${mark}"]`)!;
      const tag = (e: Element) =>
        `${e.tagName.toLowerCase()}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''}`;
      const rulesFor = (target: Element) => {
        const out: CSSStyleRule[] = [];
        const walk = (rules: CSSRuleList) => {
          for (const r of rules) {
            if (r instanceof CSSStyleRule) {
              try {
                if (target.matches(r.selectorText)) out.push(r);
              } catch {
                /* a selector the engine can't match */
              }
              if (r.cssRules?.length) walk(r.cssRules);
            } else if (r instanceof CSSMediaRule) {
              if (matchMedia(r.conditionText || r.media.mediaText).matches) walk(r.cssRules);
            } else if ('cssRules' in r && (r as CSSGroupingRule).cssRules)
              walk((r as CSSGroupingRule).cssRules);
          }
        };
        for (const sheet of document.styleSheets) {
          try {
            walk(sheet.cssRules);
          } catch {
            /* a sheet it can't read */
          }
        }
        return out;
      };
      const declared = (from: Element, prop: string) => {
        for (let at: Element | null = from; at; at = at.parentElement) {
          const rs = rulesFor(at).filter((r) => r.style.getPropertyValue(prop).trim());
          if (rs.length) {
            const r = rs[rs.length - 1]!;
            return {
              at,
              on: tag(at),
              value: r.style.getPropertyValue(prop).trim(),
              rule: r.selectorText.slice(0, 70),
            };
          }
        }
        return null;
      };
      const steps: string[] = [];
      let found = declared(el, 'color');
      let kind = "no author colour (the browser's own)";
      for (let depth = 0; found && depth < 8; depth += 1) {
        steps.push(`${found.on} ${found.rule.includes(',') ? '' : ''}{${found.value}}`);
        const v = /var\(\s*(--[\w-]+)/.exec(found.value);
        if (!v) {
          kind =
            /^(Canvas|ButtonFace|CanvasText|ButtonText|LinkText|Highlight|HighlightText|GrayText|Field|FieldText)$/i.test(
              found.value,
            )
              ? `system colour ${found.value}`
              : `literal ${found.value}`;
          break;
        }
        if (v[1]!.startsWith('--color-')) {
          kind = `role ${v[1]}`;
          break;
        }
        found = declared(found.at, v[1]!);
        if (!found) {
          kind = `composition token ${v[1]} (undeclared on the path)`;
        }
      }
      return `"${(el.textContent ?? '').trim().slice(0, 16)}" ${getComputedStyle(el).color} <- ${kind} | ${steps.join(' <- ')}`;
    }, m);
  const sources: string[] = [];
  for (const j of judged.filter((j) => j.ratio !== null && j.ratio < 4.5).slice(0, 10))
    sources.push(await trace(j.mark));
  const unjudged = judged.filter((j) => j.ratio === null).map((j) => `"${j.words}": ${j.unjudged}`);
  const readable = judged
    .filter((j) => j.ratio !== null && j.ratio >= 4.5)
    .map((j) => `"${j.words}": ${j.ratio!.toFixed(2)}:1`);
  // A positive control: plain body text (a paragraph's or an item's own words, not in the Canvas
  // colour) judged the same way, so the judge shows it can read words as readable too.
  const bodies = await page.evaluate(() => {
    const s = document.createElement('span');
    s.style.color = 'Canvas';
    document.body.append(s);
    const canvas = getComputedStyle(s).color;
    s.remove();
    let at = 0;
    for (const el of document.querySelectorAll('main p, main li, main dd')) {
      if (at >= 5) break;
      if (
        ![...el.childNodes].some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 12,
        )
      )
        continue;
      const cs = getComputedStyle(el);
      if (cs.color === canvas || cs.visibility !== 'visible' || !el.getClientRects().length)
        continue;
      if (el.closest('[data-forced-text]') || el.querySelector('[data-forced-text]')) continue;
      el.setAttribute('data-forced-text', `body-${at}`);
      at += 1;
    }
    return at;
  });
  const body: string[] = [];
  let bodyJudged = 0;
  let bodyReadable = 0;
  for (let at = 0; at < bodies; at += 1) {
    const [item] = await judgeTexts(page, `body-${at}`);
    if (!item) continue;
    if (item.ratio !== null) {
      bodyJudged += 1;
      if (item.ratio >= 4.5) bodyReadable += 1;
    }
    body.push(
      `"${item.words}": ${item.ratio === null ? item.unjudged : `${item.ratio.toFixed(2)}:1`}`,
    );
  }
  // The appearance control's panel, opened: its own texts judged as they read open.
  const panel: string[] = [];
  const summary = page.locator('[data-ui-slot="appearance-control"] summary').first();
  if ((await summary.count()) && (await summary.isVisible())) {
    await summary.evaluate((el) => {
      const details = el.closest('details');
      if (details) details.open = true;
    });
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => {
      let at = 0;
      for (const el of document.querySelectorAll('[data-ui-slot="appearance-control"] *')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
        el.setAttribute('data-forced-text', `panel-${at}`);
        at += 1;
      }
      return at;
    });
    for (let at = 0; at < open; at += 1) {
      const [item] = await judgeTexts(page, `panel-${at}`);
      if (item)
        panel.push(
          `"${item.words}": ${item.ratio === null ? item.unjudged : `${item.ratio.toFixed(2)}:1`}`,
        );
      if (item && item.ratio !== null && item.ratio < 4.5)
        panel.push(`  source ${await trace(`panel-${at}`)}`);
    }
    await summary.evaluate((el) => {
      const details = el.closest('details');
      if (details) details.open = false;
    });
  }
  const rings: unknown[] = [];
  for (const why of await page.$$eval('[data-p7-ring]', (els) =>
    els.map((el) => el.getAttribute('data-p7-ring')!),
  )) {
    const target = page.locator(`[data-p7-ring="${why}"]`).first();
    const tag = await target.evaluate(
      (el) =>
        `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} "${(el.textContent ?? '').trim().slice(0, 24)}"`,
    );
    if (!(await target.isVisible())) {
      rings.push({ why, missing: 'not visible' });
      continue;
    }
    const findings = await Promise.race([
      ringFindingsOf(page, target),
      new Promise<{ rule: string; actual?: string }[]>((r) =>
        setTimeout(() => r([{ rule: 'timeout', actual: 'no read in 20 s' }]), 20_000),
      ),
    ]);
    const outline = await target.evaluate((el) => getComputedStyle(el).outlineColor);
    rings.push({
      why,
      tag,
      outline,
      findings: findings.map((f) => `${f.rule}: ${f.actual ?? ''}`),
    });
  }
  log({
    what: 'check',
    id,
    ...c,
    canvasTexts: marked.texts,
    judged: judged.length - unjudged.length,
    vanished: vanished.length,
    vanishedSample: vanished.slice(0, 8),
    unjudged: unjudged.length,
    unjudgedSample: unjudged.slice(0, 12),
    readable: readable.length,
    readableSample: readable.slice(0, 12),
    sources,
    panel,
    body,
    bodyJudged,
    bodyReadable,
    rings,
  });
}
