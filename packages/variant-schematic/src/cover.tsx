import type { ReactNode } from 'react';
import type { Evidence, Section } from '@portfolio/schema';
import { hrefFor, type SectionRendererProps, type SectionOf } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { TitleBlock } from './chrome/title-block';
import { Balloon, Dimension } from './drawing/dimension';
import { SheetBorder } from './drawing/sheet-border';
import { InterfaceFigure } from './figure/interface';
import { dimensionLabels, heroOf, outbound, present, sheetSet } from './model';
import { figure, ownId, Phrase, Ui, When, words } from './parts';

// The cover sheet (brief §5.4, step 5): the owner drawn as a dimensioned
// elevation. The thesis's first sentence is the dimension label over the
// name (SC-M3); the name block is dimensioned on both axes (SC-S1), its
// height labelled with the current role. The lede follows as the hero has
// it. Leader notes from the curated proof hang off one orthogonal leader,
// each with a numbered balloon (SC-S9). Figure 1, the signature work drawn
// as an interface, fills the sheet's right half, and the title block takes
// its bottom-right corner (SC-M1). Nothing on it is invented: a missing
// part closes the sheet up.

export const coverHeading = (input: VariantRenderInput) => ownId(input.ids.prefix, 'name');

function Note({
  entry,
  n,
  input,
  linked,
}: {
  entry: Evidence;
  n: number;
  input: VariantRenderInput;
  linked: boolean;
}) {
  const { t, lang } = words(input);
  const metric = entry.type === 'metric' && typeof entry.metric?.value === 'number';
  const value = metric
    ? `${figure(entry.metric!.value!, input)}${present(entry.metric!.unit) ? ` ${entry.metric!.unit}` : ''}`
    : (entry.title ?? entry.statement ?? '');
  // A titled note carries its statement too, then who gave it or where it ran.
  const text = metric
    ? [entry.statement, entry.description].filter(present)
    : [
        present(entry.title) ? entry.statement : undefined,
        entry.organization ?? entry.publication ?? entry.venue,
      ].filter(present);
  const date = metric ? undefined : (entry.receivedAt ?? entry.publishedAt ?? entry.presentedAt);
  return (
    <li className="sx-note" data-metric={metric ? '' : undefined}>
      <Balloon n={n} />
      <p className="sx-note__value" data-type-role={metric ? 'headline' : 'title'}>
        {metric ? value : <Phrase source={value} input={input} />}
      </p>
      {text.length || date ? (
        <p className="sx-note__text" data-type-role="body-compact">
          {text.map((part, i) => (
            <span key={i}>
              <Phrase source={part} input={input} />
              {i < text.length - 1 || date ? '. ' : ''}
            </span>
          ))}
          {date ? <When raw={date} input={input} /> : null}
        </p>
      ) : null}
      {linked ? (
        <p className="sx-note__ref" data-type-role="label">
          <a href={`#${ownId(input.ids.prefix, 'fig-1')}`}>
            <Ui lang={lang}>{t.linkedToFig1}</Ui>
          </a>
        </p>
      ) : null}
    </li>
  );
}

/**
 * The hero's own part of the cover: the dimensioned name and the lede, as the
 * hero section's content (or alone, when the portfolio has no hero).
 */
export function CoverIdentity({
  input,
  hero,
}: {
  input: VariantRenderInput;
  hero?: SectionOf<'hero'>;
}) {
  const labels = dimensionLabels(input);
  const ctas = hero?.ctas ?? [];
  const [primary, ...rest] = ctas;
  // The hero's own name, when it gives one, is the part drawn; else the identity's.
  const name = hero && present(hero.name) ? hero.name : input.portfolio.identity.name;
  return (
    <>
      <div className="sx-elev">
        <div className="sx-elev__part">
          <Dimension delay={0} className="sx-elev__w">
            {labels.width ? (
              <span data-type-role="headline" data-source={labels.width.source}>
                {labels.width.text}
              </span>
            ) : undefined}
          </Dimension>
          <h1 className="sx-elev__name" id={coverHeading(input)} data-type-role="display">
            {name}
          </h1>
        </div>
        {/* SC-S1: the name block's height, ticks only (the role is in the title block). */}
        <Dimension axis="v" delay={1} className="sx-elev__h" decorative />
      </div>
      {hero &&
      (present(hero.subtitle) ||
        present(hero.tagline) ||
        present(hero.subtagline) ||
        ctas.length > 0) ? (
        <div className="sx-lede">
          {present(hero.subtitle) ? (
            <p className="sx-lede__sub" data-type-role="label">
              <Phrase source={hero.subtitle} input={input} />
            </p>
          ) : null}
          {present(hero.tagline) ? (
            <p className="sx-lede__tag" data-type-role="body">
              <Phrase source={hero.tagline} input={input} />
            </p>
          ) : null}
          {present(hero.subtagline) ? (
            <p className="sx-lede__sub" data-type-role="body-compact">
              <Phrase source={hero.subtagline} input={input} />
            </p>
          ) : null}
          {primary ? (
            <p className="sx-actions">
              <a
                className="sx-btn sx-btn--primary"
                href={hrefFor(primary.url, input)}
                data-type-role="label"
              >
                {primary.label}
              </a>
              {rest.map((cta) => (
                <a
                  key={cta.url}
                  href={hrefFor(cta.url, input)}
                  data-out={outbound(cta.url) ? '' : undefined}
                  data-type-role="body"
                >
                  {cta.label}
                </a>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * The cover sheet: the hero section (the identity), the notes, Figure 1 and
 * the title block in the bottom-right corner, inside the sheet border. The
 * notes, the figure and the block are the curation's and the chrome's, so
 * they sit beside the hero section on the sheet, not inside it.
 */
export function CoverSheet({
  input,
  identity,
}: {
  input: VariantRenderInput;
  identity: ReactNode;
}) {
  const { t, lang } = words(input);
  const set = sheetSet(input);
  const signature = set.signature;
  const linked = new Set(signature?.evidence ?? []);
  return (
    <div className="sx-sheet sx-sheet--cover">
      <SheetBorder rows={4}>
        <div className="sx-cover" data-figure={signature ? '' : undefined}>
          {identity}
          {signature ? (
            <div className="sx-cover__fig">
              <InterfaceFigure work={signature} no={1} input={input} level={2} cover />
            </div>
          ) : null}
          {set.notes.length > 0 ? (
            <div className="sx-notes" data-draw={2}>
              <p
                className="sx-notes__h"
                data-type-role="label"
                id={ownId(input.ids.prefix, 'notes')}
              >
                <Ui lang={lang}>{t.notes}</Ui>
              </p>
              <ol
                className="sx-notes__list"
                role="list"
                aria-labelledby={ownId(input.ids.prefix, 'notes')}
              >
                {set.notes.map((entry, i) => (
                  <Note
                    key={entry.id}
                    entry={entry}
                    n={i + 1}
                    input={input}
                    linked={linked.has(entry.id)}
                  />
                ))}
              </ol>
            </div>
          ) : null}
          <div className="sx-cover__tb">
            <TitleBlock input={input} at="cover" />
          </div>
        </div>
      </SheetBorder>
    </div>
  );
}

export function HeroRenderer({ section, input }: SectionRendererProps<SectionOf<'hero'>>) {
  return <CoverIdentity input={input} hero={section} />;
}

/** Whether a section is the cover's hero. */
export const isCover = (section: Section, input: VariantRenderInput) =>
  heroOf(input)?.id === section.id;
