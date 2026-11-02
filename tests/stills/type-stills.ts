// pnpm stills:type (P-5, thumbnail-pipeline.md §3): shoots the typography
// picker's stills, two for each of the platform's self-hosted packs, an
// "Aa" and a sample line, each in the role the catalog's role map gives it
// (TYPE_STILL_FACES: display and body, unless a pack's signature role
// differs), from the pack's own
// vendored woff2 files, and writes them with their record into
// apps/web/studio-stills/type/ for the change to commit. Registry generation
// serves them under /_portfolio/studio/, and type-stills.test.ts holds them
// to the files they were shot from.
//
// Each face loads from a data: URL of its file's bytes under a name of its
// own, so nothing but that file can set the still, and a face that doesn't
// load fails the run rather than leave a fallback in a still. The page has
// no origin to fetch from, and Chromium resolves no name, as in the trace.
// Each still is shot on a transparent ground and kept as an alpha mask,
// grey and alpha with the grey all 0, which Studio paints in its own ink.
// It writes files, and removes none.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import type * as Lib from '../../apps/web/src/lib/studio/type-stills';
import type * as Build from '../../apps/web/scripts/type-stills';
import { TRACE_LAUNCH_ARGS } from '../harness/trace/policy.mjs';

// apps/web is CommonJS to Node, so its modules load through require, as the catalog tests load them.
const require = createRequire(import.meta.url);
const { TYPE_STILL_DPR, TYPE_STILL_GEOMETRY, TYPE_STILL_SIDE_PX } =
  require('../../apps/web/src/lib/studio/type-stills.ts') as typeof Lib;
const { platformTypePacks, sha256, stillSpecs, TYPE_STILLS_DIR, TYPE_STILLS_RECORD } =
  require('../../apps/web/scripts/type-stills.ts') as typeof Build;
type TypeStillEntry = Lib.TypeStillEntry;
type TypeStillRecord = Lib.TypeStillRecord;
type TypeStillSpec = Build.TypeStillSpec;

/** A still's mask: every pixel's colour dropped, its alpha kept, packed as grey and alpha. */
function alphaMask(png: Buffer): Buffer {
  const image = PNG.sync.read(png);
  for (let at = 0; at < image.data.length; at += 4) {
    image.data[at] = 0;
    image.data[at + 1] = 0;
    image.data[at + 2] = 0;
  }
  return PNG.sync.write(image, { colorType: 4, inputColorType: 6, deflateLevel: 9 });
}

const faceName = (spec: TypeStillSpec) => `still ${spec.pack} ${spec.role}`;

/** The page the stills are shot on: one span a still, set in its own face's name, with no face yet. */
function page(specs: readonly TypeStillSpec[]): string {
  const spans = specs.map((spec) => {
    const { fontPx, linePx } = TYPE_STILL_GEOMETRY[spec.role];
    // Single quotes inside the attribute, which its double quotes delimit.
    const style = [
      `font-family: '${faceName(spec)}', 'still fallback'`,
      `font-weight: ${spec.face.weight}`,
      `font-style: ${spec.face.style}`,
      `letter-spacing: ${spec.face.tracking}`,
      `font-size: ${fontPx}px`,
      `line-height: ${linePx}px`,
      `height: ${linePx}px`,
      `padding: 0 ${TYPE_STILL_SIDE_PX}px`,
    ].join('; ');
    if (/["<>&]/.test(style + spec.text)) {
      throw new Error(`${spec.pack}.${spec.role}'s style or text would break the page's markup.`);
    }
    return `<div><span data-still="${spec.pack}.${spec.role}" style="${style}">${spec.text}</span></div>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
html, body { margin: 0; background: transparent; color: #000; }
body { padding: 8px; }
div { margin: 0 0 8px; }
span { display: inline-block; white-space: nowrap; box-sizing: border-box; }
</style></head><body>${spans.join('')}</body></html>`;
}

async function main() {
  const packs = platformTypePacks();
  const specs = packs.flatMap((pack) => stillSpecs(pack));
  // --dry-run: what it would shoot, and the page it would shoot it on, with no browser.
  if (process.argv.includes('--dry-run')) {
    const html = page(specs);
    for (const spec of specs) {
      console.log(
        `[stills:type] would shoot ${spec.pack}.${spec.role} in its ${spec.face.role} role from ${spec.sources.length} file(s)`,
      );
    }
    console.log(
      `[stills:type] dry run: ${specs.length} stills, a ${html.length} B page, nothing written`,
    );
    return;
  }
  const browser = await chromium.launch({ args: TRACE_LAUNCH_ARGS });
  const stills: TypeStillEntry[] = [];
  try {
    const context = await browser.newContext({
      deviceScaleFactor: TYPE_STILL_DPR,
      viewport: { width: 800, height: 1200 },
    });
    // The page fetches nothing: its faces come from the files' bytes, handed over below.
    await context.route('**/*', (route) => route.abort());
    const tab = await context.newPage();
    await tab.setContent(page(specs), { waitUntil: 'load' });
    for (const spec of specs) {
      const selector = `[data-still="${spec.pack}.${spec.role}"]`;
      const files = spec.sources.map((source) => readFileSync(source.path).toString('base64'));
      // Each face the still sets loads from its own file's bytes, through the FontFace API, so no
      // fetch is involved; the text must then set wider or narrower than in the fallback, or the
      // run stops rather than shoot a fallback.
      const loaded = await tab.evaluate(
        async ({ sel, name, style, files }) => {
          const element = document.querySelector<HTMLElement>(sel)!;
          const fallback = element.getBoundingClientRect().width;
          const errors: string[] = [];
          for (const file of files) {
            const bytes = Uint8Array.from(atob(file), (char) => char.charCodeAt(0));
            const face = new FontFace(name, bytes.buffer, { weight: '1 1000', style });
            try {
              await face.load();
              document.fonts.add(face);
            } catch (error) {
              errors.push(String(error));
            }
          }
          await document.fonts.ready;
          const computed = getComputedStyle(element);
          const ready = document.fonts.check(
            `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} "${name}"`,
            element.textContent ?? '',
          );
          // Whole CSS pixels, so the still maps 1:1 onto its rem box.
          const set = element.getBoundingClientRect().width;
          const width = Math.ceil(set);
          element.style.width = `${width}px`;
          return { ready, errors, fallback, set, width, fontSize: computed.fontSize };
        },
        { sel: selector, name: faceName(spec), style: spec.face.style, files },
      );
      const { fontPx, linePx } = TYPE_STILL_GEOMETRY[spec.role];
      if (loaded.fontSize !== `${fontPx}px`) {
        throw new Error(`${spec.pack}.${spec.role} set at ${loaded.fontSize}, not ${fontPx}px.`);
      }
      if (!loaded.ready || loaded.errors.length > 0 || loaded.set === loaded.fallback) {
        throw new Error(
          `${spec.pack}'s ${spec.role} face didn't set its text (ready ${loaded.ready}, ` +
            `${loaded.fallback} px in the fallback against ${loaded.set} px` +
            `${loaded.errors.length > 0 ? `, ${loaded.errors.join('; ')}` : ''}), so its still would be a fallback.`,
        );
      }
      const shot = await tab.locator(selector).screenshot({ omitBackground: true, type: 'png' });
      const mask = alphaMask(shot);
      const { width, height } = PNG.sync.read(mask);
      if (height !== linePx * TYPE_STILL_DPR || width !== loaded.width * TYPE_STILL_DPR) {
        throw new Error(
          `${spec.pack}.${spec.role} shot ${width}x${height}, not ${loaded.width * TYPE_STILL_DPR}x${linePx * TYPE_STILL_DPR}.`,
        );
      }
      const file = `${spec.pack}.${spec.role}.png`;
      mkdirSync(TYPE_STILLS_DIR, { recursive: true });
      writeFileSync(path.join(TYPE_STILLS_DIR, file), mask);
      stills.push({
        pack: spec.pack,
        role: spec.role,
        file,
        text: spec.text,
        width: width / TYPE_STILL_DPR,
        height: height / TYPE_STILL_DPR,
        pixelWidth: width,
        pixelHeight: height,
        bytes: mask.length,
        sha256: sha256(mask),
        face: spec.face,
        sources: spec.sources.map((source) => ({
          file: source.file,
          sha256: sha256(readFileSync(source.path)),
        })),
      });
      console.log(
        `[stills:type] ${file}, its ${spec.face.role} role: ${width}x${height}, ${mask.length} B`,
      );
    }
  } finally {
    await browser.close();
  }
  const record: TypeStillRecord = {
    version: 1,
    generator: 'pnpm stills:type (tests/stills/type-stills.ts)',
    dpr: TYPE_STILL_DPR,
    stills,
  };
  writeFileSync(TYPE_STILLS_RECORD, `${JSON.stringify(record, null, 2)}\n`);
  const total = stills.reduce((sum, still) => sum + still.bytes, 0);
  console.log(
    `[stills:type] ${stills.length} stills, ${total} B, in ${path.relative(process.cwd(), TYPE_STILLS_DIR)}`,
  );
}

await main();
