import {
  anchorSection,
  MediaFigure,
  present,
  renderContext,
  RichText,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, figureOf, said, type Companion, type HomeModel } from './model';
import { Words } from './parts';

// The anchor band (TF-M4): the report's 2fr 1fr 1fr grid under the arc.
// The photograph is the 2fr plate the arc opens onto, its caption on a
// paper plate inside its lower edge; the two companions are captioned
// plates on the paper ground, not cards: a hairline over each, a kicker,
// its words, and, for a figure, the figure at headline size under its
// caption. With no photograph the two plates take six columns each. With
// neither, the band isn't there.

/** The kicker over a companion: why it's here, in the composition's words or its section's title. */
function companionKicker(companion: Companion, input: VariantRenderInput): string | undefined {
  if (companion.kind === 'work') return companion.signature ? 'Signature work' : undefined;
  const section = anchorSection(companion.record, input);
  return section && 'title' in section && said(section.title) ? section.title : undefined;
}

function Plate({
  companion,
  index,
  input,
  uiLang,
}: {
  companion: Companion;
  index: number;
  input: VariantRenderInput;
  uiLang: 'en' | undefined;
}) {
  const id = chromeIds(input.ids.prefix).companion(index);
  const kicker = companionKicker(companion, input);
  const ownKicker = companion.kind === 'work';
  if (companion.kind === 'work') {
    const { work } = companion;
    const since = work.period?.start ? String(work.period.start).slice(0, 4) : undefined;
    return (
      <article
        className="tf-plate"
        id={id}
        data-plate={index + 1}
        lang={work.lang}
        aria-labelledby={`${id}-title`}
      >
        {kicker ? (
          <p className="tf-label tf-kicker">
            {ownKicker ? <Words lang={uiLang}>{kicker}</Words> : kicker}
          </p>
        ) : null}
        <h3 className="tf-title tf-plate__title" id={`${id}-title`}>
          {companion.href ? <a href={companion.href}>{work.title}</a> : work.title}
        </h3>
        {present(work.summary) ? (
          <RichText source={work.summary} className="tf-compact tf-second" input={input} />
        ) : null}
        {said(work.role) || since ? (
          <p className="tf-compact tf-muted">
            {said(work.role) ? work.role : null}
            {said(work.role) && since ? ', ' : null}
            {since ? (
              <>
                <Words lang={uiLang}>since</Words> <span className="tf-num">{since}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </article>
    );
  }
  const { record } = companion;
  const metric =
    record.type === 'metric' && record.metric?.value !== undefined ? record.metric : undefined;
  const words = said(record.title) ? record.title : record.statement;
  return (
    <figure
      className="tf-plate"
      id={id}
      data-plate={index + 1}
      lang={record.lang}
      data-figure={metric ? '' : undefined}
    >
      <figcaption className="tf-plate__cap">
        {kicker ? <span className="tf-label tf-kicker">{kicker}</span> : null}
        {said(words) ? (
          <span className="tf-title tf-plate__title">
            {!metric && companion.href ? (
              <a href={companion.href}>
                <RichText source={words} inline input={input} />
              </a>
            ) : (
              <RichText source={words} inline input={input} />
            )}
          </span>
        ) : null}
        {said(record.description) ? (
          <span className="tf-compact tf-second">{record.description}</span>
        ) : null}
      </figcaption>
      {metric ? (
        <p className="tf-plate__figure tf-headline tf-num">
          {companion.href ? (
            <a href={companion.href}>
              {figureOf(metric.value!, record.lang ?? input.portfolio.locale)}
            </a>
          ) : (
            figureOf(metric.value!, record.lang ?? input.portfolio.locale)
          )}
          {said(metric.unit) ? (
            <span className="tf-plate__unit tf-title"> {metric.unit}</span>
          ) : null}
        </p>
      ) : null}
    </figure>
  );
}

export function AnchorBand({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const { photo, companions } = model.band;
  if (!photo && companions.length === 0) return null;
  const ids = chromeIds(input.ids.prefix);
  const ctx = renderContext(
    input,
    { id: photo?.work.id ?? 'band', lang: photo?.work.lang, title: undefined },
    2,
  );
  return (
    <section
      className="tf-page tf-band"
      id={ids.band}
      aria-labelledby={ids.bandTitle}
      data-photo={photo ? '' : 'none'}
      data-plates={companions.length}
    >
      <h2 className="tf-sr" id={ids.bandTitle}>
        <Words lang={model.uiLang}>In the opening</Words>
      </h2>
      {photo ? (
        <figure className="tf-band__photo" lang={photo.work.lang}>
          <div className="tf-band__frame">
            <MediaFigure
              placed={{ ...photo.image, caption: undefined }}
              ctx={ctx}
              inline
              eager
              sizes="(min-width: 48rem) 50vw, 100vw"
            />
          </div>
          <figcaption className="tf-band__cap tf-compact">
            {present(photo.placement.caption) ? (
              <span className="tf-caption">{photo.placement.caption}</span>
            ) : null}{' '}
            <span>
              {photo.href ? <a href={photo.href}>{photo.work.title}</a> : photo.work.title}
              {photo.count > 1 ? (
                <>
                  {', '}
                  <span className="tf-num">{photo.count}</span>{' '}
                  <Words lang={model.uiLang}>photographs</Words>
                </>
              ) : null}
            </span>
          </figcaption>
        </figure>
      ) : null}
      {companions.map((companion, index) => (
        <Plate
          key={companion.kind === 'work' ? companion.work.id : companion.record.id}
          companion={companion}
          index={index}
          input={input}
          uiLang={model.uiLang}
        />
      ))}
    </section>
  );
}
