import test from 'node:test';
import assert from 'node:assert/strict';
import { pageOutline } from '@portfolio/kit/sections';
import { echoesTab, folds, headOf, openingOf, proofLine, sheetsOf } from '../model';
import {
  count,
  inputFor,
  pairOf,
  renderInput,
  sampleInput,
  textOf,
  withReadyMedia,
} from './harness.test';

// The code review's targeted tests (FX P1 round 4), one for each mutant the
// content test can't see: the key phrase shown once, the proof line's cap,
// section titles that show, the Index's section list, and which kinds fold.

const occurrences = (text: string, phrase: string) => text.split(phrase).length - 1;

test('the key phrase shows once: in the h1, never again in the thesis frame (m6)', () => {
  const input = sampleInput();
  const { text } = textOf(renderInput(input));
  assert.equal(occurrences(text, openingOf(input).key.text), 1);
  const pair = pairOf({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    practice: { thesis: 'I print small books. Each one is set by hand, one sheet at a time.' },
    sections: [
      { kind: 'hero', id: 'top', tagline: 'Letterpress.' },
      { kind: 'practice', id: 'thesis', part: 'thesis' },
    ],
  });
  const thesis = textOf(renderInput(inputFor(pair))).text;
  assert.equal(occurrences(thesis, 'I print small books.'), 1);
  assert.equal(occurrences(thesis, 'Each one is set by hand, one sheet at a time.'), 1);
});

test('the proof line holds three items at most, in the owner order (m3)', () => {
  const metric = (id: string, value: number, statement: string) => ({
    id,
    type: 'metric',
    statement,
    metric: { value },
  });
  const pair = pairOf({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    evidence: [
      metric('a', 1, 'Presses restored'),
      metric('b', 2, 'Books bound'),
      metric('c', 3, 'Type cases'),
      metric('d', 4, 'Apprentices'),
    ],
    proof: ['a', 'b', 'c', 'd'],
    sections: [{ kind: 'hero', id: 'top', tagline: 'Letterpress.' }],
  });
  const input = inputFor(pair);
  assert.deepEqual(
    proofLine(input).map((item) => item.id),
    ['a', 'b', 'c'],
  );
  const html = renderInput(input);
  const proof = /<ul class="fx-proof"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  assert.equal(count(proof, /<li>/g), 3);
  assert.doesNotMatch(proof, /Apprentices/);
});

test('a titled section shows its title, unless the title repeats its sheet tab word (m18)', () => {
  const input = sampleInput();
  const html = renderInput(input);
  const sheets = sheetsOf(input, pageOutline(input));
  let checked = 0;
  for (const sheet of sheets) {
    for (const [index, section] of sheet.sections.entries()) {
      const head = headOf(section);
      if (head.own || ['hero', 'cta'].includes(section.kind)) continue;
      if (section.kind === 'practice' && section.part === 'thesis') continue;
      const echoes = echoesTab(head.title, sheet.word, index === 0);
      const heading = new RegExp(`id="[^"]*${section.id}--h" class="([^"]+)"`).exec(html);
      assert.ok(heading, `${section.id} has a heading`);
      if (echoes) assert.equal(heading[1], 'fx-hidden', `${section.id} repeats its tab`);
      else {
        assert.equal(heading[1], 'fx-sec__title', `${section.id}'s title shows`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 10, `${checked} titled sections checked`);
});

test('the Index lists every section of every sheet, each a link to it (m11)', () => {
  const input = sampleInput();
  const html = renderInput(input);
  const index = html.slice(html.indexOf('class="fx-index"'));
  assert.ok(index.length > 0);
  const prefix = input.ids.prefix;
  let listed = 0;
  for (const sheet of sheetsOf(input, pageOutline(input)))
    for (const section of sheet.sections) {
      assert.match(index, new RegExp(`href="[^"]*#${prefix}${section.id}"`), section.id);
      listed += 1;
    }
  assert.ok(listed >= 20, `${listed} sections listed`);
});

test('only the record and the practice chips fold: works, words, voices and the close never do (m20)', () => {
  const input = sampleInput();
  const record = new Set(['evidence', 'chronology', 'github']);
  for (const section of input.portfolio.sections) {
    const chips =
      section.kind === 'practice' && (section.part === 'skills' || section.part === 'tools');
    if (record.has(section.kind) || chips) continue;
    assert.equal(folds(section, input), false, `${section.id} (${section.kind}) never folds`);
  }
  // And the record does: the full record folds behind its disclosure.
  assert.ok(input.portfolio.sections.some((section) => folds(section, input)));
});

test('the figures, the repositories, the plate link and the gallery pictures render (m8, m24, m27, m29)', () => {
  const html = renderInput(sampleInput());
  // At a glance: each metric's figure beside its words.
  const glance = /<ul class="fx-glance__line"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  assert.match(glance, /<strong class="fx-num">12<\/strong> Years engineering/);
  // The GitHub section's repositories, from the snapshot.
  for (const repo of ['postmortem-template-kit', 'small-traces', 'quorum-sim'])
    assert.match(html, new RegExp(`>${repo}<`), repo);
  // The plate's title links to the signature's page.
  assert.match(
    html,
    /<h2 class="fx-plate__title" id="[^"]*"[^>]*><a href="[^"]*\/work\/postmortem-template-kit"/,
  );
  // The gallery: each picture in its frame, once the media is processed.
  const ready = renderInput(withReadyMedia(sampleInput()));
  const frames = [...ready.matchAll(/<li class="fx-frame"[^>]*>([\s\S]*?)<\/li>/g)];
  assert.ok(frames.length >= 3, `${frames.length} frames`);
  for (const [, frame] of frames) assert.match(frame!, /<img\b/);
});

test('with no contact section, the footer lists the email and the links (n8)', () => {
  const pair = pairOf({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Noor Nocontact', email: 'noor@nocontact.test' },
    links: [{ platform: 'github', url: 'https://github.com/noor' }],
    sections: [{ kind: 'hero', id: 'top', tagline: 'I build small tools.' }],
  });
  const html = renderInput(inputFor(pair));
  const footer = /<footer class="fx-foot">([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? '';
  assert.match(footer, /href="mailto:noor@nocontact\.test"/);
  assert.match(footer, /href="https:\/\/github\.com\/noor"[^>]*>GitHub/);
});

test('the close lists a link once, even when a further call to action names it too (R-2)', () => {
  const html = renderInput(sampleInput());
  const close = /<ul class="fx-close__links"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  const hrefs = [...close.matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
  assert.ok(hrefs.length > 0);
  assert.equal(new Set(hrefs).size, hrefs.length, hrefs.join(' '));
});
