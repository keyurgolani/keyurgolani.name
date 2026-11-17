// The read: Mission Control's home at 320 with the root text at 200%, everything whose right edge
// runs past the window, each with whether a fixed layer or a scroller of its own holds it, its box,
// its styles that set a width and its parent's, nearest the page's own scroll width first. A shot of
// the window's right edge. Readings and the shot go to PROOF_LOOK_OUT. One appOptions a file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';

test.use({
  viewport: { width: 320, height: 568 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test('mission control home at 320 with the root text at 200%: what runs past the window', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const read = await page.evaluate(() => {
    const html = document.documentElement;
    const edge = html.clientWidth;
    const name = (el: Element | null) =>
      el
        ? `${el.localName}${[...el.classList]
            .slice(0, 3)
            .map((c) => `.${c}`)
            .join('')}`
        : '';
    const chain = (el: Element) => {
      const parts: string[] = [];
      for (let n: Element | null = el; n && n !== html && parts.length < 6; n = n.parentElement)
        parts.unshift(name(n));
      return parts.join(' > ');
    };
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= edge + 0.5) continue;
      let held = '';
      for (let n: Element | null = el; n && n !== html; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.position === 'fixed') {
          held = `fixed ${name(n)}`;
          break;
        }
        if (n !== el && s.overflowX !== 'visible') {
          held = `${s.overflowX} ${name(n)} right ${Math.round(n.getBoundingClientRect().right * 10) / 10}`;
          break;
        }
      }
      const s = getComputedStyle(el);
      const ps = el.parentElement ? getComputedStyle(el.parentElement) : null;
      out.push({
        chain: chain(el),
        held,
        box: [r.left, r.right, r.width, r.top, r.height].map((v) => Math.round(v * 10) / 10),
        css: `${s.display} pos ${s.position} w ${s.width} minw ${s.minWidth} maxw ${s.maxWidth} ws ${s.whiteSpace} ow ${s.overflowWrap} wb ${s.wordBreak} flex ${s.flex} m ${s.marginLeft}/${s.marginRight} pad ${s.paddingLeft}/${s.paddingRight} tf ${s.transform}`,
        parent: ps
          ? `${name(el.parentElement)} ${ps.display} w ${ps.width} gtc ${ps.gridTemplateColumns.slice(0, 60)} gap ${ps.columnGap} pad ${ps.paddingLeft}/${ps.paddingRight} ov ${ps.overflowX}`
          : '',
        text: (el.textContent ?? '').trim().slice(0, 40),
      });
    }
    out.sort((a, b) => (a.box[1] ?? 0) - (b.box[1] ?? 0));
    return { scroll: html.scrollWidth, client: edge, count: out.length, past: out.slice(0, 40) };
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'overflow-320-200.json'), JSON.stringify(read, null, 1));
  console.log(`overflow 320 200%: scroll ${read.scroll}, ${read.count} past the edge`);
  for (const line of read.past.filter((each) => !each.held))
    console.log(`overflow unheld: ${JSON.stringify(line)}`);
  await page.evaluate(() => window.scrollTo(document.documentElement.scrollWidth, 0));
  await page.screenshot({ path: path.join(OUT, 'right-edge-320-200.png'), animations: 'disabled' });
});
