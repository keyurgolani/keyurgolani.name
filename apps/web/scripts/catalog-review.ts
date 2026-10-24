// What the owner reads before accepting a generated scheme (#20 PR 3):
// `pnpm catalog show <id>` adds its reference record to the entry, and
// `pnpm catalog review [--out <dir>]` writes one HTML page per generated
// scheme, the image-derived ones first, with the source image beside every
// color role's swatch in all four sets, the colors it extracted, its
// anchors and every move, and its contrast report. The pages are static
// files, with the image copied beside them; nothing is served or fetched.
// The rehearsal uploads them as reports-rehearsal-review.

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACCEPTANCE_FILE,
  GENERATED_DIR,
  readAcceptance,
  recordDigest,
  type PackPackage,
} from '@portfolio/appearance/node';
import { COLOR_ROLES } from '@portfolio/appearance';
import { generatedEntries, type GeneratedEntry } from './catalog-generated';

/** Whether the owner's acceptance pins the entry's committed record, by `pnpm catalog show`'s words. */
export function acceptanceStatus(root: string, entry: GeneratedEntry, pkgDir: string): string {
  if (entry.declared.input !== 'asset')
    return 'needs no acceptance: it generates from a seed color';
  if (entry.recorded === null) return 'waits: no reference record is committed';
  const accepted = readAcceptance(path.join(root, pkgDir))[entry.id];
  if (!accepted)
    return `waits for the owner's acceptance in ${pkgDir}/${GENERATED_DIR}/${ACCEPTANCE_FILE}`;
  return accepted.record === recordDigest(entry.recorded)
    ? `accepted by ${accepted.acceptedBy} on ${accepted.acceptedAt}`
    : 'waits: the owner accepted an earlier record';
}

const count = (moves: object | undefined) =>
  Object.values(moves ?? {}).reduce((total, set) => total + Object.keys(set as object).length, 0);

/** The lines `pnpm catalog show` adds for a generated scheme, or none for any other id. */
export function generatedLines(
  root: string,
  packages: readonly PackPackage[],
  id: string,
): string[] {
  const entry = generatedEntries(root, packages).entries.find((each) => each.id === id);
  if (!entry?.record) return [];
  const pkg = packages.find(({ name }) => name === entry.packageName)!;
  const { result, source } = entry.record;
  const input =
    'file' in source
      ? `${source.sourceAsset}, drawn from ${source.file} (pixels ${'pixelsSha256' in result.input ? result.input.pixelsSha256 : 'unhashed'})`
      : source.seedColor;
  const failing = result.contrastReport.pairs.filter(({ passes }) => !passes).length;
  return [
    '',
    `Generator: ${result.generator.id}, version ${result.generator.version} (${result.algorithm})`,
    `Reference input: ${input}`,
    ...(result.extracted
      ? [
          `Extracted: ${result.extracted.map(({ hex, share, score }) => `${hex} (${Math.round(share * 100)}%, score ${score})`).join(', ')}`,
        ]
      : []),
    ...(['light', 'dark'] as const).map(
      (mode) =>
        `Anchors, ${mode}: ${Object.entries(result.anchors!.used[mode])
          .map(([role, hex]) => `${role} ${hex}`)
          .join(', ')}`,
    ),
    `Moves: ${count(result.adjustments!.generator)} by the generator, ${count(result.adjustments!['anchor-v2'])} by anchor-v2`,
    ...result.notes!.map((note) => `Note: ${note}`),
    `Contrast report: ${result.contrastReport.pairs.length} pairs, ${failing} failing, read ${result.reading}`,
    `Record: ${entry.file} (${entry.recorded === null ? 'not committed' : recordDigest(entry.recorded)})`,
    `Review: ${acceptanceStatus(root, entry, pkg.dir)}`,
  ];
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One scheme's review page. */
function page(entry: GeneratedEntry, status: string, image: string | null): string {
  const { result, source } = entry.record!;
  const sets = {
    light: result.tokens.light,
    dark: result.tokens.dark,
    'high-contrast-light': result.tokens.highContrast?.light,
    'high-contrast-dark': result.tokens.highContrast?.dark,
  };
  const swatch = (hex: string) =>
    `<span class="swatch" style="background:${escape(hex)}"></span><code>${escape(hex)}</code>`;
  const table = Object.entries(sets)
    .filter(([, set]) => set)
    .map(
      ([name, set]) =>
        `<h3>${escape(name)}</h3><table><tbody>${COLOR_ROLES.map(
          (role) =>
            `<tr><th>${escape(role)}</th><td>${swatch((set as Record<string, string>)[role]!)}</td></tr>`,
        ).join('')}</tbody></table>`,
    )
    .join('');
  const failing = result.contrastReport.pairs.filter(({ passes }) => !passes);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(entry.id)}: generated scheme review</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:2rem;max-width:72rem}img{max-width:24rem;border:1px solid #888}
.swatch{display:inline-block;width:2.5rem;height:1.25rem;border:1px solid #888;vertical-align:middle;margin-right:.5rem}
table{border-collapse:collapse;margin-bottom:1rem}th{text-align:left;font-weight:500;padding-right:1rem}
.sets{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:1rem}</style></head>
<body><h1>${escape(entry.id)}</h1>
<p>${escape(result.generator.id)} version ${result.generator.version}, ${escape(result.algorithm ?? '')}. ${escape(status)}.</p>
${image ? `<p><img src="${escape(image)}" alt="The source image, ${escape('file' in source ? source.file : '')}"></p>` : `<p>Seed ${swatch('seedColor' in source ? source.seedColor : '#000000')}</p>`}
${result.extracted ? `<h2>Extracted</h2><p>${result.extracted.map(({ hex, share, score }) => `${swatch(hex)} ${Math.round(share * 100)}%, score ${score}`).join('<br>')}</p>` : ''}
<h2>Anchors</h2>${(['light', 'dark'] as const)
    .map(
      (mode) =>
        `<p><b>${mode}</b>: ${Object.entries(result.anchors!.used[mode])
          .map(([role, hex]) => `${escape(role)} ${swatch(hex)}`)
          .join(' ')}</p>`,
    )
    .join('')}
${result.notes!.map((note) => `<p>${escape(note)}</p>`).join('')}
<h2>Every role</h2><div class="sets">${table}</div>
<h2>Contrast report</h2><p>${result.contrastReport.pairs.length} pairs, ${failing.length} failing, read ${escape(result.reading ?? '')}.</p>
</body></html>
`;
}

/** Writes the review pages under `out`, the image-derived schemes first, and returns what it wrote. */
export function writeReview(root: string, packages: readonly PackPackage[], out: string): string[] {
  mkdirSync(out, { recursive: true });
  const entries = generatedEntries(root, packages)
    .entries.filter((entry) => entry.record)
    .sort((a, b) =>
      a.declared.input === b.declared.input
        ? a.id < b.id
          ? -1
          : 1
        : a.declared.input === 'asset'
          ? -1
          : 1,
    );
  const written: string[] = [];
  for (const entry of entries) {
    const pkg = packages.find(({ name }) => name === entry.packageName)!;
    const { source } = entry.record!;
    let image: string | null = null;
    if ('file' in source) {
      image = `${entry.id}${path.extname(source.file)}`;
      copyFileSync(path.join(root, source.file), path.join(out, image));
    }
    const file = path.join(out, `${entry.id}.html`);
    writeFileSync(file, page(entry, acceptanceStatus(root, entry, pkg.dir), image));
    written.push(file);
  }
  const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Generated scheme review</title></head><body><h1>Generated scheme review</h1><ul>${entries
    .map((entry) => `<li><a href="${escape(entry.id)}.html">${escape(entry.id)}</a></li>`)
    .join('')}</ul></body></html>\n`;
  writeFileSync(path.join(out, 'index.html'), index);
  return [...written, path.join(out, 'index.html')];
}

/**
 * The owner's acceptance of an image-derived scheme (`pnpm catalog accept
 * <id> --by <name>`): it pins the SHA-256 of the scheme's committed
 * reference record in its package's acceptance.json, so the next build
 * registers the scheme. Only the owner runs it, after reading the review
 * page, and commits what it writes. A new record makes it stale again.
 */
export function acceptScheme(
  root: string,
  packages: readonly PackPackage[],
  id: string,
  by: string,
  on: Date = new Date(),
): { readonly ok: true; readonly file: string } | { readonly ok: false; readonly problem: string } {
  const entry = generatedEntries(root, packages).entries.find((each) => each.id === id);
  if (!entry) return { ok: false, problem: `${id} isn't a generated scheme.` };
  if (entry.declared.input !== 'asset') {
    return { ok: false, problem: `${id} generates from a seed color, and needs no acceptance.` };
  }
  if (entry.recorded === null || entry.recorded !== entry.text) {
    return {
      ok: false,
      problem: `${id}'s reference record isn't current. Run pnpm catalog:generated, review it, and commit it first.`,
    };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(by)) {
    return { ok: false, problem: `--by takes the owner's GitHub login, such as keyurgolani.` };
  }
  const pkg = packages.find(({ name }) => name === entry.packageName)!;
  const file = path.join(root, pkg.dir, GENERATED_DIR, ACCEPTANCE_FILE);
  const accepted = {
    ...readAcceptance(path.join(root, pkg.dir)),
    [id]: {
      record: recordDigest(entry.recorded),
      acceptedBy: by,
      acceptedAt: on.toISOString().slice(0, 10),
    },
  };
  const sorted = Object.fromEntries(Object.entries(accepted).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  return { ok: true, file };
}
