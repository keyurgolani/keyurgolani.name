import {
  chronologyOf,
  RichText,
  type SectionOf,
  type SectionRenderer,
} from '@portfolio/kit/sections';
import { languageDirection } from '@portfolio/schema/direction';
import { chronologyLanes, laneColour, stableDigest } from '../model';
import { Link, Range, uiLangOf, Words, workHref } from '../parts';

// `git log --graph <id>` (chronology): each entry a commit on its thread's
// lane, newest first, with the |/ fork where a branch joins. The graph and
// the hash are shell idiom, hidden from assistive tech (SH-S3); the range,
// the subject and the message are the entry.

export const GitLog: SectionRenderer<SectionOf<'chronology'>> = ({ section, input }) => {
  const entries = chronologyOf(section, input);
  const { lanes, rows, width } = chronologyLanes(entries);
  const uiLang = uiLangOf(input);
  // Right to left, the lanes run from the inline start on the right, so a fork's slant mirrors.
  const rtl =
    (section.lang ? languageDirection(section.lang) : input.portfolio.direction) === 'rtl';
  const glyphOf = (glyph: string) =>
    rtl && glyph === '/' ? '\\' : rtl && glyph === '\\' ? '/' : glyph;
  const named = lanes.filter((lane) => lane !== undefined).length > 1;
  const shownThread = new Set<number>();
  const works = new Map(input.portfolio.works.map((work) => [work.id, work]));
  return (
    <ol className="sh-gl" style={{ '--layout-lanes': width } as React.CSSProperties}>
      {rows.map((row, i) => {
        // A lane runs on below this row when the next row draws it in the same column.
        const next = rows[i + 1]?.cells;
        const graph = (
          <span className="sh-gl__g" aria-hidden="true">
            {row.cells.map((cell, c) => (
              <span key={c} data-lane={cell.lane === undefined ? undefined : laneColour(cell.lane)}>
                {glyphOf(cell.glyph)}
              </span>
            ))}
            {row.kind === 'entry'
              ? row.cells.map((cell, c) =>
                  cell.lane !== undefined &&
                  (cell.glyph === '*' || cell.glyph === '|') &&
                  next?.[c]?.lane === cell.lane &&
                  next[c]!.glyph !== ' ' ? (
                    <i
                      key={`l${c}`}
                      className="sh-gl__lane"
                      data-lane={laneColour(cell.lane)}
                      style={{ '--layout-col': c } as React.CSSProperties}
                    />
                  ) : null,
                )
              : null}
          </span>
        );
        if (row.kind !== 'entry') {
          return (
            <li key={`${row.kind}-${i}`} className="sh-gl__conn" aria-hidden="true">
              {graph}
            </li>
          );
        }
        const { entry, lane } = row;
        const first = !shownThread.has(lane);
        shownThread.add(lane);
        const bullets = [...(entry.highlights ?? []), ...(entry.achievements ?? [])];
        const made = (entry.works ?? []).flatMap((id) => {
          const work = works.get(id);
          return work ? [work] : [];
        });
        return (
          <li key={entry.id} lang={entry.lang}>
            {graph}
            <span className="sh-gl__hash" aria-hidden="true">
              {stableDigest(entry.id)}
            </span>
            <span className="sh-gl__rng">
              <Range period={entry.period} lang={uiLang} />
            </span>
            <p className="sh-gl__subj">
              {entry.field ? `${entry.title}, ${entry.field}` : entry.title}
              {entry.organization ? (
                <span className="sh-gl__org">
                  {' '}
                  <span className="sh-faint">@</span>{' '}
                  {entry.organizationUrl ? (
                    <Link url={entry.organizationUrl} input={input}>
                      {entry.organization}
                    </Link>
                  ) : (
                    entry.organization
                  )}
                  {entry.location ? `, ${entry.location}` : ''}
                </span>
              ) : entry.location ? (
                <span className="sh-gl__org">
                  {' '}
                  <span className="sh-faint">@</span> {entry.location}
                </span>
              ) : null}
              {named && first && entry.thread ? (
                <span className="sh-gl__deco">
                  {' ('}
                  <b>{entry.thread}</b>
                  {')'}
                </span>
              ) : null}
            </p>
            {entry.description || bullets.length > 0 || made.length > 0 || entry.skills?.length ? (
              <div className="sh-gl__msg">
                {entry.description ? <RichText source={entry.description} input={input} /> : null}
                {bullets.length > 0 ? (
                  <ul>
                    {bullets.map((text, b) => (
                      <li key={b}>{text}</li>
                    ))}
                  </ul>
                ) : null}
                {made.length > 0 ? (
                  <p className="sh-gl__tr">
                    <Words lang={uiLang}>works:</Words>{' '}
                    {made.map((work, w) => {
                      const href = workHref(input, work.id);
                      return (
                        <span key={work.id}>
                          {w > 0 ? ', ' : ''}
                          {href ? <a href={href}>{work.title}</a> : work.title}
                        </span>
                      );
                    })}
                  </p>
                ) : null}
                {entry.skills?.length ? (
                  <p className="sh-gl__tr">{entry.skills.join(', ')}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
};
