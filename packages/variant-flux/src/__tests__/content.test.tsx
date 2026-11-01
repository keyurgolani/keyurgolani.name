import test from 'node:test';
import { appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chronologyOf, evidenceOf, worksOf } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { hasCaseStudy, isShownAbove, leadOf, plainInline } from '../model';
import {
  FIXTURE_NAMES,
  fixtureInput,
  inputFor,
  pairOf,
  renderInput,
  sampleInput,
  textOf,
} from './harness.test';

// Every authored string the home page places is on it (the code review's
// content test, FX P1 round 4). For the sample and the 16 contract fixtures,
// it collects the identity's name, tagline and email; each section's own
// fields; the fields of the records each section places (its works,
// evidence and chronology entries, its practice part, the contact); and
// testimonial sources. Each must appear in the page's text, Markdown reduced
// to its words. What Flux leaves out on purpose is declared in OMITTED below,
// each with its reason, so a dropped field fails here unless someone rules
// it out in writing.

/** Fields that carry no visible words: ids, URLs, dates, enums, numbers, references and media. */
const NOT_WORDS = new Set([
  'id',
  'url',
  'href',
  'slug',
  'asset',
  'kind',
  'type',
  'medium',
  'part',
  'visibility',
  'lang',
  'locale',
  'direction',
  'schemaVersion',
  'src',
  'start',
  'end',
  'publishedAt',
  'releasedAt',
  'presentedAt',
  'receivedAt',
  'grantedAt',
  'filedAt',
  'asOf',
  'extensions',
  'thread',
  'branchesFrom',
  'mergesInto',
  'avatar',
  'cover',
  'media',
  'logo',
  'focalPoint',
  'fit',
  'organizationUrl',
  'pdfUrl',
  'slidesUrl',
  'videoUrl',
  'audioUrl',
  'sourceUrl',
  'username',
  'value',
  'unit',
  'key',
  'featured',
  'archived',
  'status',
  'format',
  'platform',
  'durationMinutes',
  'durationSeconds',
  'readingTimeMinutes',
  'stars',
  'year',
  'evidence',
  'works',
  'related',
  'relations',
  'source',
  'show',
  'timeZone',
  'iconName',
  'metric',
  'filter',
  'limit',
  'ids',
  'sort',
  'layout',
  // A GitHub section's repository names are references the snapshot resolves; one it lacks shows nothing.
  'featuredRepos',
  'excludeRepos',
]);

/**
 * What Flux leaves out of the home page on purpose: a path pattern each,
 * matched against the field's place in the collection (`section:<id>(<kind>)`,
 * then `/work:<id>`, `/ev:<id>`, `/chr:<id>`, `/practice.<part>`, `/contact`).
 */
const OMITTED: readonly { readonly path: RegExp; readonly why: string }[] = [
  {
    path: /\/(?:work|plate)(?:\+case)?:[^.]+\.caseStudy\./,
    why: "a case study is the work's own page (routes.work), never the home's",
  },
  {
    path: /\/(?:work|plate)\+case:[^.]+\.tools\b/,
    why: 'a work with a case study lists its tools on its own page (routes.work); one without lists them on its card, row or plate',
  },
  {
    path: /\/(?:work|plate)\+case:[^.]+\.tags\b/,
    why: 'a work with a case study lists its tags on its own page (routes.work)',
  },
  {
    path: /\/(?:work|plate)\+case:[^.]+\.links\[\d+\]/,
    why: 'a work with a case study keeps its links on its own page',
  },
  {
    path: /\/work(?:\+case)?:[^.]+\.highlights\[(?:[2-9]|\d{2,})\]/,
    why: 'a work card or row keeps its first two highlights (works.tsx)',
  },
  {
    path: /\/(?:work|plate)\+case:[^.]+\.description$/,
    why: 'a work with a case study shows its summary here, and its description on its own page; one without folds its description under its summary',
  },
  {
    path: /\/plate\+case:[^.]+\.(?:highlights|role|organization|publication|series|artist|label)\b/,
    why: "the plate's credits and highlights are its own page's (routes.work), which the plate links to; the opening's proof line carries its figures (FX-S7), and F4 keeps the caption to its kicker, title and summary",
  },
  {
    path: /\/ev:[^.]+\.links\[0\]\.label$/,
    why: "a record's title takes its first link when it has no URL of its own",
  },
  {
    path: /\/chr:[^.]+\.(?:achievements|highlights)\[(?:[3-9]|\d{2,})\]/,
    why: 'a progress-line entry keeps its first three points (record.tsx); P2 folds the rest',
  },

  {
    path: /^section:[^(]+\(hero\)\.(?:name|title)$/,
    why: "the opening is the h1, one positioning line, the now line and one call to action (brief §5.10): the hero's name is the h1's, and its title labels the opening's foot on wide screens",
  },
];

interface Authored {
  readonly path: string;
  readonly text: string;
}

function strings(value: unknown, at: string, out: Authored[]): void {
  if (typeof value === 'string') {
    if (value.trim()) out.push({ path: at, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => strings(item, `${at}[${index}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (NOT_WORDS.has(key)) continue;
      strings(item, `${at}.${key}`, out);
    }
  }
}

/** A testimonial's source is an object: its name, role and organization are words. */
function sourceStrings(entry: Record<string, unknown>, at: string, out: Authored[]): void {
  const source = entry.source as Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object') return;
  for (const key of ['name', 'role', 'organization'])
    if (typeof source[key] === 'string')
      out.push({ path: `${at}.source.${key}`, text: source[key] });
}

/** Every authored string the home page places, with where it came from. */
export function authored(input: VariantRenderInput): Authored[] {
  const out: Authored[] = [];
  const { portfolio } = input;
  strings(
    {
      name: portfolio.identity.name,
      tagline: portfolio.identity.tagline,
      email: portfolio.identity.email,
    },
    'identity',
    out,
  );
  for (const section of portfolio.sections) {
    const at = `section:${section.id}(${section.kind})`;
    // A section's own items are references (works, evidence, entries) or its list, collected below.
    const own: Record<string, unknown> = { ...section };
    delete own.items;
    strings(own, at, out);
    if (section.kind === 'quote' && typeof section.source === 'string')
      out.push({ path: `${at}.source`, text: section.source });
    if (section.kind === 'custom' || section.kind === 'focus' || section.kind === 'fun-facts')
      strings((section as { items?: unknown }).items, `${at}.items`, out);
    if (section.kind === 'works')
      for (const work of worksOf(section, input)) {
        const tag = isShownAbove(work, input) ? 'plate' : 'work';
        strings(work, `${at}/${tag}${hasCaseStudy(work) ? '+case' : ''}:${work.id}`, out);
      }
    if (section.kind === 'evidence')
      for (const entry of evidenceOf(section, input)) {
        strings(entry, `${at}/ev:${entry.id}`, out);
        sourceStrings(entry as unknown as Record<string, unknown>, `${at}/ev:${entry.id}`, out);
      }
    if (section.kind === 'chronology')
      for (const entry of chronologyOf(section, input))
        strings(entry, `${at}/chr:${entry.id}`, out);
    if (section.kind === 'practice' && section.part === 'thesis') {
      // The thesis shows in two places: its first sentence is the h1's key phrase, the rest the frame's.
      const thesis = portfolio.practice?.thesis;
      if (thesis)
        for (const [part, words] of Object.entries(leadOf(thesis)))
          if (words) out.push({ path: `${at}/practice.thesis.${part}`, text: words });
    } else if (section.kind === 'practice')
      strings(
        (portfolio.practice as Record<string, unknown> | undefined)?.[section.part],
        `${at}/practice.${section.part}`,
        out,
      );
    if (section.kind === 'contact') {
      // A contact link to the email the close already sets as its line is left out with its label.
      const email = portfolio.identity.email?.trim().toLowerCase();
      const links = (portfolio.contact?.links ?? []).filter(
        (link) => !(email && link.url.trim().toLowerCase() === `mailto:${email}`),
      );
      strings({ ...portfolio.contact, links }, `${at}/contact`, out);
    }
  }
  return out;
}

/**
 * Text as the match compares it: Markdown reduced to its words, lower case, with no
 * whitespace or punctuation, so a line the page breaks, a sentence it splits into a
 * label and its gloss, or a list it joins with commas still matches its source.
 */
const norm = (text: string) =>
  plainInline(text)
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, '');

/** The authored strings `input`'s render doesn't show, less what OMITTED rules out. */
export function missing(input: VariantRenderInput): string[] {
  // A run's rest folds behind "More, n" (parts.tsx More): that label is the composition's, set
  // between an authored text's first part and its rest, so it's read past here. The record's own
  // folds keep their summaries, which hold the sections' titles.
  const html = renderInput(input).replace(
    /(<details class="fx-fold fx-more"[^>]*>)<summary class="fx-fold__summary">[\s\S]*?<\/summary>/g,
    '$1',
  );
  const { text, attrs } = textOf(html);
  const page = norm(text);
  const labels = norm(attrs);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { path, text: raw } of authored(input)) {
    if (seen.has(path) || OMITTED.some((rule) => rule.path.test(path))) continue;
    seen.add(path);
    const words = norm(raw);
    if (!words) continue;
    // Long text: its head and its tail, so a cut shows.
    const parts = words.length > 80 ? [words.slice(0, 50), words.slice(-30)] : [words];
    if (parts.every((part) => page.includes(part) || labels.includes(part))) continue;
    out.push(`${path}: ${JSON.stringify(words.slice(0, 100))}`);
  }
  return out;
}

/** A pair no fixture covers: a testimonial with a description, and a work with tools, a summary and a description, and no case study. */
const EDGE = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Noor Edge', email: 'noor@edge.test' },
  works: [
    {
      id: 'solo',
      title: 'Solo',
      medium: 'software',
      summary: 'A small sync tool.',
      description: 'It keeps two folders the same, slowly and carefully.',
      tools: ['Rust', 'SQLite'],
    },
  ],
  evidence: [
    {
      id: 'praise',
      type: 'testimonial',
      statement: 'Noor made the review calm.',
      description: 'Said after the 2024 review cycle.',
      source: { name: 'Sam Lee', role: 'Engineering manager' },
    },
  ],
  sections: [
    { kind: 'hero', id: 'top', tagline: 'I build small tools.' },
    { kind: 'works', id: 'work', title: 'Work', items: ['solo'] },
    { kind: 'evidence', id: 'voices', title: 'Voices', items: ['praise'] },
  ],
};

const INPUTS: readonly (readonly [string, () => VariantRenderInput])[] = [
  ['sample', () => sampleInput()],
  ...FIXTURE_NAMES.map((name) => [name, () => fixtureInput(name)] as const),
  ['edge pair', () => inputFor(pairOf(EDGE))],
];

for (const [name, input] of INPUTS) {
  test(`${name}: every authored string the home places is on the page, or ruled out in OMITTED`, () => {
    const list = missing(input());
    if (process.env.FLUX_MISSING_DUMP)
      appendFileSync(
        process.env.FLUX_MISSING_DUMP,
        list.map((line) => `${name} ${line}\n`).join(''),
      );
    assert.deepEqual(list, []);
  });
}

test('the sample and the complete fixture show their hero subtagline (the code review, must-fix 1)', () => {
  assert.match(
    textOf(renderInput(sampleInput())).text,
    /Currently leading reliability for a platform that handles 10B requests a day\./,
  );
  assert.match(textOf(renderInput(fixtureInput('complete'))).text, /Hero subtagline/);
});
