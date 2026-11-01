import type { Evidence } from '@portfolio/schema';
import {
  DateText,
  evidenceOf,
  formatFigure,
  Heading,
  MaybeLink,
  present,
  renderContext,
  RichText,
  shownPlace,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { recordId } from './scenes';
import { SectionHead } from './words';

// Evidence (redesign): the record as the credits would set it, never as a
// row of hero numbers. Figures are a list of what each measures beside its
// value at title size; words from people are quotes with who said them;
// everything else is a dated record, its title and where it happened on
// one ruled row. Every record keeps its anchor on the first section that
// lists it.

type Section = SectionOf<'evidence'>;

/** When a record happened, from the field its type dates it by. */
function whenOf(entry: Evidence): string | undefined {
  return (
    entry.publishedAt ??
    entry.presentedAt ??
    entry.receivedAt ??
    entry.grantedAt ??
    entry.filedAt ??
    entry.asOf
  );
}

/** Where a record happened or who gave it, in words. */
function whereOf(entry: Evidence): string {
  return [
    entry.venue,
    entry.organization,
    entry.publication,
    shownPlace(entry.location),
    entry.assignee,
    entry.number,
  ]
    .filter(present)
    .join(', ');
}

/** A figure's value as the content's language writes it, with its unit. */
function valueOf(entry: Evidence, ctx: RenderContext): string | undefined {
  const value = entry.metric?.value;
  if (value === undefined) return undefined;
  const unit = entry.metric?.unit;
  return `${formatFigure(value, ctx)}${present(unit) ? ` ${unit}` : ''}`;
}

function Figures({
  entries,
  section,
  ctx,
}: {
  entries: readonly Evidence[];
  section: Section;
  ctx: RenderContext;
}) {
  return (
    <dl className="hc-figures">
      {entries.map((entry) => (
        <div key={entry.id} id={recordId(section, entry, ctx.input)} lang={entry.lang}>
          <dt data-type-role="body-compact">
            {present(entry.statement) ? (
              <RichText source={entry.statement} inline input={ctx.input} />
            ) : (
              entry.title
            )}
          </dt>
          <dd data-type-role="title">{valueOf(entry, ctx) ?? entry.title}</dd>
        </div>
      ))}
    </dl>
  );
}

function Quotes({
  entries,
  section,
  ctx,
}: {
  entries: readonly Evidence[];
  section: Section;
  ctx: RenderContext;
}) {
  return (
    <ul className="hc-quotes" role="list">
      {entries.map((entry) => (
        <li key={entry.id} id={recordId(section, entry, ctx.input)} lang={entry.lang}>
          <blockquote data-type-role="title">
            <RichText source={entry.statement ?? entry.title ?? ''} input={ctx.input} />
          </blockquote>
          <p className="hc-quotes__who" data-type-role="label">
            {[entry.source?.name, entry.source?.role, entry.source?.organization]
              .filter(present)
              .join(', ')}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Records({
  entries,
  section,
  ctx,
}: {
  entries: readonly Evidence[];
  section: Section;
  ctx: RenderContext;
}) {
  return (
    <ol className="hc-records" role="list">
      {entries.map((entry) => {
        const when = whenOf(entry);
        const where = whereOf(entry);
        const words = entry.excerpt ?? entry.statement ?? entry.description;
        return (
          <li
            key={entry.id}
            id={recordId(section, entry, ctx.input)}
            lang={entry.lang}
            data-type={entry.type}
          >
            {/* An undated record takes the whole row, with no empty date gutter. */}
            {when ? (
              <p className="hc-records__when" data-type-role="label">
                <DateText raw={when} ctx={ctx} />
              </p>
            ) : null}
            <div className="hc-records__what">
              <Heading level={ctx.itemLevel} className="hc-records__title">
                <span data-type-role="body">
                  <MaybeLink url={present(entry.url) ? entry.url : undefined} ctx={ctx}>
                    {entry.title ?? where}
                  </MaybeLink>
                </span>
              </Heading>
              {where && present(entry.title) ? (
                <p className="hc-records__where" data-type-role="body-compact">
                  {where}
                </p>
              ) : null}
              {present(words) ? (
                <RichText source={words} className="hc-records__words" input={ctx.input} />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function EvidenceSection({ section, input, level }: SectionRendererProps<Section>) {
  const ctx = renderContext(input, section, level);
  const entries = evidenceOf(section, input);
  const figures = entries.filter((entry) => entry.type === 'metric');
  const quotes = entries.filter((entry) => entry.type === 'testimonial');
  const records = entries.filter(
    (entry) => entry.type !== 'metric' && entry.type !== 'testimonial',
  );
  return (
    <>
      <SectionHead section={section} level={level} />
      {figures.length > 0 ? <Figures entries={figures} section={section} ctx={ctx} /> : null}
      {quotes.length > 0 ? <Quotes entries={quotes} section={section} ctx={ctx} /> : null}
      {records.length > 0 ? <Records entries={records} section={section} ctx={ctx} /> : null}
    </>
  );
}
