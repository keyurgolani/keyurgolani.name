import type { Section, Work } from '@portfolio/schema';
import { hrefFor, recordAnchor } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { formatNumber, present } from '../model';
import { LinkLine, More, Out, Phrase, When, Words, uiLang } from '../parts';
import { workHref } from './work-href';

// Episodes (brief §5.2): audio and video as one numbered list inside the
// band's lite: the episode's number where the owner gave one, its title,
// the series, when, how long, and a Listen or Watch link.

type Works = Extract<Section, { kind: 'works' }>;

export function Episodes({
  works,
  section,
  input,
}: {
  works: readonly Work[];
  section: Works;
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  const locale = input.portfolio.locale;
  return (
    <ol className="ag-rows ag-episodes">
      {works.map((work) => {
        const href = workHref(work, input);
        const play = work.audioUrl ?? work.videoUrl;
        const summary = work.summary ?? work.description;
        return (
          <li
            key={work.id}
            className="ag-row ag-episode"
            id={recordAnchor(section, work, input)}
            lang={work.lang}
          >
            {work.number ? (
              <span className="ag-episode__no ag-num" data-type-role="numeric">
                {formatNumber(work.number, locale)}
              </span>
            ) : null}
            <h4 className="ag-row__title" data-type-role="title">
              {href ? (
                <a href={href}>
                  {work.title}
                  <Out href={href} />
                </a>
              ) : (
                work.title
              )}
            </h4>
            {present(summary) ? (
              <p className="ag-row__sum" data-type-role="body-compact">
                <Phrase source={summary} input={input} />
              </p>
            ) : null}
            {work.guests?.some(present) ? (
              <p className="ag-row__where" data-type-role="caption">
                <Words lang={lang}>With </Words>
                {work.guests.filter(present).join(', ')}
              </p>
            ) : null}
            <p className="ag-row__foot" data-type-role="caption">
              {present(work.series) ? <span>{work.series}</span> : null}
              {work.publishedAt ? (
                <span>
                  <When raw={work.publishedAt} lang={lang} />
                </span>
              ) : null}
              {work.durationMinutes ? (
                <span className="ag-num">
                  <Words
                    lang={lang}
                  >{`${formatNumber(Math.round(work.durationMinutes), locale)} min`}</Words>
                </span>
              ) : null}
              {play ? (
                <a href={hrefFor(play, input)}>
                  <Words lang={lang}>{work.videoUrl && !work.audioUrl ? 'Watch' : 'Listen'}</Words>
                  <Out href={play} />
                </a>
              ) : null}
            </p>
            {present(work.showNotes) ? (
              <More label="Show notes" of={work} source={work.showNotes} input={input} />
            ) : null}
            <LinkLine links={work.links} input={input} />
          </li>
        );
      })}
    </ol>
  );
}
