import test from 'node:test';
import assert from 'node:assert/strict';
import { worksOf } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { plainWords, workHref } from '../model';
import { escaped, fixtureInput, renderInput, sampleInput } from './harness.test';

// What the owner wrote shows on home in Raw Grid's own grammar (the content sweep,
// apps/web/src/server/content-sweep.test.tsx, which holds every route against the fallback):
// each field the sweep found missing, in the form and place it takes here.

const complete = () => renderInput(fixtureInput('complete'));

/** Whether an element with this class holds this text, within its first 600 characters. */
const within = (html: string, className: string, text: string) =>
  [...html.matchAll(new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`, 'g'))].some((match) =>
    html.slice(match.index, match.index + 600).includes(text),
  );

test("a record's DOI is a label line linking to doi.org, the address wrapping at its points", () => {
  const html = complete();
  assert.match(
    html,
    /<p class="rg-meta"><a href="https:\/\/doi\.org\/10\.1000\/tide\.42">DOI <span>10<wbr\/>\.1000<wbr\/>\/tide<wbr\/>\.42<\/span>/,
  );
});

test("evidence: an external work's place beside its action, a talk's abstract, a figure's source", () => {
  const html = complete();
  // Its action is the link (buttonText), so its place, in his words, is on the facts line.
  assert.ok(within(html, 'rg-meta', 'photos<wbr/>.rowan<wbr/>.test'), 'external work place');
  assert.ok(within(html, 'rg-t-desc', 'Talk abstract.'), 'talk abstract');
  assert.match(html, /<a href="https:\/\/data\.rowan\.test\/ships"[^>]*>Stat source<\/a>/);
});

test("practice: a tool group's description, a service group's name as its offers' meta line", () => {
  const html = complete();
  assert.ok(within(html, 'rg-skill__desc', 'Stack group description'));
  assert.match(html, /<div class="rg-card__body"><p class="rg-meta">Service group<\/p>/);
});

test("works: an essay's tags, an episode's series, show notes and links, a photograph's tags", () => {
  const html = complete();
  assert.match(html, /<ul class="rg-chips" role="list"><li>Writing tag<\/li><\/ul>/);
  assert.ok(within(html, 'rg-t-desc', 'Episode show notes.'), 'show notes');
  assert.ok(within(html, 'rg-meta', 'Episodes show name'), 'series');
  assert.match(html, /<a href="https:\/\/pod\.rowan\.test\/12\/notes">Episode link/);
  assert.ok(within(html, 'rg-meta', 'Gallery tag'), 'photo tags');
});

test("an episode's series that is the table's own title isn't said again on its row", () => {
  // The sample's Incident History episodes are each in the series the section is titled by.
  const html = renderInput(sampleInput());
  const table = html.slice(html.indexOf('rg-table--episodes'));
  const rows = table.slice(0, table.indexOf('</table>'));
  assert.equal(rows.includes('Incident History'), true, 'the caption names it');
  assert.equal(rows.match(/Incident History/g)?.length, 1, 'once, as the caption');
});

test('the opening and the close: subtitles under their tapes, the CTA subtitle, the email, a custom caption', () => {
  const html = complete();
  assert.ok(within(html, 'rg-meta', 'Hero subtitle'), 'hero subtitle');
  assert.ok(within(html, 'rg-meta', 'Thesis subtitle'), 'thesis subtitle');
  assert.match(html, /<p class="rg-ink__lead">[\s\S]*?<\/p><p>Cta subtitle<\/p>/);
  assert.match(
    html,
    /<figure class="rg-item__fig">[\s\S]*?<figcaption class="rg-meta">Custom item caption<\/figcaption>/,
  );
  // The big link is the call to action's own address, so his email leads the ways.
  assert.match(
    html,
    /<ul class="rg-cell rg-ink__links" role="list"><li><a href="mailto:rowan@rowan\.test"/,
  );
  const mixed = renderInput(fixtureInput('mixed'));
  assert.match(mixed, /rg-ink__links[^>]*><li><a href="mailto:layla@haddad\.test"/);
});

test('a work with no page of its own says its description on its card, and pinned, its summary on the pin', () => {
  const sample = renderInput(sampleInput());
  assert.ok(within(sample, 'rg-card__sum', 'OpenTelemetry is a wonderful thing'), 'small-traces');
  assert.ok(
    within(sample, 'rg-card__sum', 'Written for teams with no game-day'),
    'chaos-curriculum',
  );
  // The signature has its own page, which holds its description: the pin says its summary.
  assert.ok(within(sample, 'rg-pin__sum', 'An opinionated, batteries-included'), 'signature pin');
  assert.equal(within(sample, 'rg-pin__sum', 'Three years of running postmortem'), false);
  const large = renderInput(fixtureInput('large'));
  assert.ok(within(large, 'rg-pin__sum', 'Project 1 of a hundred'), 'large pin');
});

/**
 * Every listing of a work on home, the pin and each card, as its own stretch of the page: from
 * where it starts to where the next starts, or its band ends.
 */
function listings(html: string): readonly string[] {
  const starts = [...html.matchAll(/class="rg-cell rg-pin"|<li class="rg-slot"/g)].map(
    (match) => match.index,
  );
  return starts.map((start, index) => {
    const end = Math.min(
      starts[index + 1] ?? html.length,
      html.indexOf('</section>', start) === -1 ? html.length : html.indexOf('</section>', start),
    );
    return html.slice(start, end);
  });
}

/** Works home lists, each once. */
const listedWorks = (input: VariantRenderInput) => {
  const seen = new Map<string, ReturnType<typeof worksOf>[number]>();
  for (const section of input.portfolio.sections)
    if (section.kind === 'works')
      for (const work of worksOf(section, input)) seen.set(work.id, work);
  return [...seen.values()];
};

test("a work's description is left to its own page only where home links straight there and says its summary (the lead's ruling 2(c))", () => {
  for (const [name, input] of [
    ['sample', sampleInput()],
    ['complete', fixtureInput('complete')],
  ] as const) {
    const html = renderInput(input);
    const shown = listings(html);
    let checked = 0;
    for (const work of listedWorks(input)) {
      const href = workHref(work, input);
      if (href === undefined || !work.description?.trim()) continue;
      const summary = work.summary?.trim();
      assert.ok(
        summary,
        `${name}: ${work.id} has a page and no summary, so home says its description`,
      );
      const words = escaped(plainWords(summary).slice(0, 40));
      checked++;
      assert.ok(
        shown.some(
          (listing) => listing.includes(`href="${escaped(href)}"`) && listing.includes(words),
        ),
        `${name}: ${work.id}'s listing on home links to ${href} and says its summary`,
      );
    }
    assert.ok(checked > 0, `${name}: no work with a page of its own was checked`);
  }
});
