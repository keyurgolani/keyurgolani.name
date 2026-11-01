import type { Section } from '@portfolio/schema';
import {
  chronologyOf,
  hrefFor,
  recordAnchor,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { beadOf, chronologyLanes, present, rangeOf } from '../model';
import { Prose, uiLang, Words } from '../parts';

// The glass rail (brief §5.2, chronology): a vertical rail of beads, one per
// entry, by thread: work beads in the accent, study beads hollow, the rest
// on an offset lane. An entry that grew out of another, or folded into one,
// says so in words beside its bead, since the fork's line is drawing only.
// The list is the order; the rail is decoration over it.

type Chronology = Extract<Section, { kind: 'chronology' }>;

export function ChronologyRenderer({ section, input }: SectionRendererProps<Chronology>) {
  const lang = uiLang(input.portfolio.locale);
  const lanes = chronologyLanes(chronologyOf(section, input));
  const byId = new Map(lanes.map((each) => [each.entry.id, each.entry]));
  return (
    <ol
      className="ag-rail"
      data-lanes={String(Math.min(3, new Set(lanes.map((each) => each.lane)).size))}
    >
      {lanes.map(({ entry, lane, branchesFrom, mergesInto }) => {
        const range = rangeOf(entry.period);
        const from = branchesFrom ? byId.get(branchesFrom) : undefined;
        const into = mergesInto ? byId.get(mergesInto) : undefined;
        const org = present(entry.organization) ? entry.organization : undefined;
        return (
          <li
            key={entry.id}
            className="ag-stop"
            id={recordAnchor(section, entry, input)}
            lang={entry.lang}
            data-bead={beadOf(entry)}
            data-lane={String(Math.min(lane, 2))}
            data-fork={from ? 'from' : into ? 'into' : undefined}
          >
            <span className="ag-stop__bead" aria-hidden="true" />
            <div className="ag-stop__body">
              {/* The title, then its dates: the order read is the order seen, the dates at the row's end. */}
              <h4 className="ag-stop__title" data-type-role="title">
                {entry.title}
              </h4>
              <p className="ag-stop__when ag-num" data-type-role="caption">
                {range ? range.open ? <Words lang={lang}>{range.text}</Words> : range.text : null}
              </p>
              {org || present(entry.location) || present(entry.field) ? (
                <p className="ag-stop__where" data-type-role="body-compact">
                  {org ? (
                    entry.organizationUrl ? (
                      <a href={hrefFor(entry.organizationUrl, input)}>{org}</a>
                    ) : (
                      <span>{org}</span>
                    )
                  ) : null}
                  {present(entry.field) ? <span>{entry.field}</span> : null}
                  {present(entry.location) ? <span>{entry.location}</span> : null}
                </p>
              ) : null}
              {from || into ? (
                <p className="ag-stop__fork" data-type-role="caption">
                  <Words lang={lang}>{from ? 'Grew out of ' : 'Folded into '}</Words>
                  <span>{(from ?? into)!.title}</span>
                </p>
              ) : null}
              {present(entry.description) ? (
                <Prose
                  source={entry.description}
                  input={input}
                  role="body-compact"
                  className="ag-stop__text"
                />
              ) : null}
              {entry.highlights?.length ? (
                <ul className="ag-stop__points" data-type-role="body-compact">
                  {entry.highlights.filter(present).map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {entry.achievements?.some(present) ? (
                <ul className="ag-stop__points" data-type-role="body-compact">
                  {entry.achievements.filter(present).map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {entry.skills?.some(present) ? (
                <p className="ag-stop__where" data-type-role="caption">
                  {entry.skills.filter(present).join(', ')}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
