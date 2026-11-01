import { evidenceOf } from '@portfolio/kit/sections';
import type { Evidence, Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { present, squash, type Panel } from '../model';
import { Phrase, When } from '../parts';
import { headingId, PanelLabel } from './panel';

// Panel 5, References (brief §5.7): who vouches. One voice large, the rest
// beside it at title size, each with who said it; a section of papers,
// awards or press reads the same way, its titles as the voices and the
// venue and date as the credit.

/** Who said it: the name, then the role and the organization. */
function Credit({ entry, input }: { entry: Evidence; input: VariantRenderInput }) {
  if (entry.type === 'testimonial' && entry.source) {
    const rest = [entry.source.role, entry.source.organization].filter(present).map(squash);
    return (
      <figcaption data-type-role="body">
        <b>{squash(entry.source.name)}</b>
        {rest.length > 0 ? `, ${rest.join(', ')}` : null}
      </figcaption>
    );
  }
  const where = [entry.venue, entry.organization, entry.publication].find(present);
  const when = entry.publishedAt ?? entry.receivedAt ?? entry.presentedAt;
  if (!where && !when) return null;
  return (
    <figcaption data-type-role="body">
      {where ? squash(where) : null}
      {where && when ? ', ' : null}
      {when ? <When raw={when} input={input} /> : null}
    </figcaption>
  );
}

function Voice({
  entry,
  input,
  lead,
}: {
  entry: Evidence;
  input: VariantRenderInput;
  lead: boolean;
}) {
  const words = entry.type === 'testimonial' ? entry.statement : (entry.title ?? entry.statement);
  if (!present(words)) return null;
  const quoted = entry.type === 'testimonial' || entry.type === 'press';
  return (
    <figure
      className={lead ? 'sg-refs__lead' : 'sg-refs__voice'}
      lang={entry.lang}
      data-sg-rise={lead ? 'lead' : 'support'}
    >
      <blockquote
        className={quoted ? 'sg-refs__said' : 'sg-refs__said sg-refs__said--title'}
        data-type-role={lead ? 'headline' : 'title'}
      >
        <p>
          {quoted ? '“' : null}
          <Phrase source={words} input={input} />
          {quoted ? '”' : null}
        </p>
      </blockquote>
      <Credit entry={entry} input={input} />
    </figure>
  );
}

export function References({
  input,
  panel,
  section,
}: {
  input: VariantRenderInput;
  panel: Panel;
  section: Section;
}) {
  const [lead, ...rest] = evidenceOf(section, input);
  return (
    <div className="sg-refs">
      <h2
        className="sg-label"
        id={headingId(input, panel)}
        tabIndex={-1}
        data-sg-heading=""
        data-type-role="title"
        data-sg-rise="meta"
      >
        <PanelLabel input={input} panel={panel} />
      </h2>
      {present(section.subtitle) ? (
        <p className="sg-panel__sub" data-type-role="body" data-sg-rise="meta">
          <Phrase source={section.subtitle} input={input} />
        </p>
      ) : null}
      {lead ? <Voice entry={lead} input={input} lead /> : null}
      {rest.length > 0 ? (
        <div className="sg-refs__more">
          {rest.map((entry) => (
            <Voice key={entry.id} entry={entry} input={input} lead={false} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
