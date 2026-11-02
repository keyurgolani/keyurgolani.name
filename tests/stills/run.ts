// pnpm stills (#6, item 1): shoots each registered variant's catalog stills
// from the build, as the trace renders it, on the `complete` contract
// fixture with the default packs, and writes them into the variant's own
// package as stills/1440.webp and stills/720.webp, for the package to commit
// and list in its manifest's `stills`. Run it after `pnpm build` with the
// fixture flags of the variants you want shot, and pass --variant <id> for
// fewer. The page holds still under reduced motion, so a still shows the
// first render a visitor gets.
//
// The server binds 127.0.0.1 alone, and Chromium resolves nothing else, as
// in the trace (tests/harness/trace/policy.mjs).
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { TRACE_LAUNCH_ARGS } from '../harness/trace/policy.mjs';
import { TRACE_FIXTURE } from '../trace/targets';
import { fixtureApp, WEB } from '../variants/target';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = path.join(WEB, 'src', 'lib', 'generated', 'asset-manifest.json');

/** The widths each still is written at, from the 1440x900 render. */
export const STILL_WIDTHS = [1440, 720] as const;
const VIEWPORT = { width: 1440, height: 900 };

interface Unit {
  readonly kind: string;
  readonly id: string;
  readonly packageName: string;
}

function variants(only: readonly string[]): Unit[] {
  const { units } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { units: Unit[] };
  const registered = units.filter((unit) => unit.kind === 'variant');
  const unknown = only.filter((id) => !registered.some((unit) => unit.id === id));
  if (unknown.length > 0) {
    throw new Error(`--variant ${unknown.join(', ')}: this build registers no such variant.`);
  }
  return registered.filter((unit) => only.length === 0 || only.includes(unit.id));
}

async function main(argv: readonly string[]) {
  const only = argv.flatMap((arg, index) => (argv[index - 1] === '--variant' ? [arg] : []));
  const fixture = contractFixture(TRACE_FIXTURE);
  const browser = await chromium.launch({ args: TRACE_LAUNCH_ARGS });
  try {
    for (const unit of variants(only)) {
      const app = await startApp(fixtureApp(fixture, { manifest: { id: unit.id } }));
      try {
        const page = await browser.newPage({
          viewport: VIEWPORT,
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
        });
        await page.goto(`${app.origin}/`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const png = await page.screenshot({ type: 'png' });
        const dir = path.join(
          realpathSync(path.join(WEB, 'node_modules', unit.packageName)),
          'stills',
        );
        mkdirSync(dir, { recursive: true });
        const declared = [];
        for (const width of STILL_WIDTHS) {
          const height = Math.round((VIEWPORT.height * width) / VIEWPORT.width);
          // Chromium encodes WebP itself, so the still needs no image tool.
          const encoded = await page.evaluate(
            async ({ source, width, height }) => {
              const image = new Image();
              image.src = `data:image/png;base64,${source}`;
              await image.decode();
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const context = canvas.getContext('2d')!;
              context.imageSmoothingQuality = 'high';
              context.drawImage(image, 0, 0, width, height);
              return canvas.toDataURL('image/webp', 0.82).split(',')[1]!;
            },
            { source: png.toString('base64'), width, height },
          );
          const file = path.join(dir, `${width}.webp`);
          const bytes = Buffer.from(encoded, 'base64');
          writeFileSync(file, bytes);
          declared.push({ file: `./stills/${width}.webp`, width, height });
          console.log(
            `[stills] ${unit.id}: ${path.relative(ROOT, file)} ${width}x${height}, ${bytes.length} B`,
          );
        }
        console.log(`[stills] ${unit.id}'s manifest: "stills": ${JSON.stringify(declared)}`);
        await page.close();
      } finally {
        await app.stop();
      }
    }
  } finally {
    await browser.close();
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
