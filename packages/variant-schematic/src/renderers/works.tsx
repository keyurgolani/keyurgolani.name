import type { CSSProperties } from 'react';
import type { Work } from '@portfolio/schema';
import {
  deeper,
  hrefFor,
  MediaFigure,
  placedImage,
  renderContext,
  worksOf,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Dimension } from '../drawing/dimension';
import { InterfaceFigure } from '../figure/interface';
import { DRAWINGS_SHOWN, essayShares, linkLabel, present, sheetSet, workForm } from '../model';
import { Caption, figure, ownId, Phrase, Port, Prose, Ui, When, words } from '../parts';

// Works (brief §5.4, step 7). Software and systems are drawn as interface
// figures, the signature replaced by one back-reference to Figure 1 on the
// cover (N6). Writing is a set of essay sheets, each drawn to its reading
// time (15rem + 9rem × minutes / the longest) with a vertical dimension;
// audio and video a schedule; image series their photographs under one
// caption system; music its tracks as a chain dimension drawn to scale.

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Drawings({
  works,
  input,
  level,
  fig,
}: {
  works: readonly Work[];
  input: VariantRenderInput;
  level: SectionRendererProps<unknown>['level'];
  fig: number;
}) {
  const { t, lang } = words(input);
  const { signature } = sheetSet(input);
  const rest = works.filter((work) => work.id !== signature?.id);
  const onCover = signature && works.some((work) => work.id === signature.id);
  return (
    <>
      {onCover ? (
        <p className="sx-backref" data-type-role="body-compact">
          <a href={`#${ownId(input.ids.prefix, 'fig-1')}`}>
            <Ui lang={lang}>{t.fig}</Ui>&nbsp;1, {signature.title}
          </a>{' '}
          <Ui lang={lang}>{t.onCover}.</Ui>
        </p>
      ) : null}
      {rest.length ? (
        <div className="sx-figs" data-count={Math.min(rest.length, DRAWINGS_SHOWN)}>
          {rest.slice(0, DRAWINGS_SHOWN).map((work, i) => (
            <InterfaceFigure
              key={work.id}
              work={work}
              no={fig + i}
              input={input}
              level={deeper(level)}
            />
          ))}
        </div>
      ) : null}
      {rest.length > DRAWINGS_SHOWN ? (
        <details className="sx-more">
          <summary className="sx-btn" data-type-role="label">
            <Ui lang={lang}>{t.moreDrawings(rest.length - DRAWINGS_SHOWN)}</Ui>
          </summary>
          <div className="sx-figs" data-count={rest.length - DRAWINGS_SHOWN}>
            {rest.slice(DRAWINGS_SHOWN).map((work, i) => (
              <InterfaceFigure
                key={work.id}
                work={work}
                no={fig + DRAWINGS_SHOWN + i}
                input={input}
                level={deeper(level)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function Essays({
  works,
  input,
  level,
}: {
  works: readonly Work[];
  input: VariantRenderInput;
  level: SectionRendererProps<unknown>['level'];
}) {
  const { t, lang } = words(input);
  const shares = essayShares(works);
  const Heading = `h${deeper(level)}` as 'h4';
  return (
    <ol className="sx-docs" role="list">
      {works.map((work) => (
        <li
          key={work.id}
          className="sx-doc"
          style={{ '--layout-doc': String(shares.get(work.id) ?? 0) } as CSSProperties}
          lang={work.lang}
        >
          <article className="sx-doc__sheet">
            <Heading className="sx-doc__title" data-type-role="title">
              {work.url ? <Port href={hrefFor(work.url, input)}>{work.title}</Port> : work.title}
            </Heading>
            {present(work.excerpt ?? work.summary) ? (
              <p className="sx-doc__ex" data-type-role="body-compact">
                <Phrase source={(work.excerpt ?? work.summary)!} input={input} />
              </p>
            ) : null}
            {present(work.excerpt) && present(work.summary) && work.summary !== work.excerpt ? (
              <p className="sx-doc__sum" data-type-role="body-compact">
                <Phrase source={work.summary} input={input} />
              </p>
            ) : null}
            {present(work.description) ? (
              <details className="sx-abstract">
                <summary data-type-role="label">
                  <Ui lang={lang}>{t.description}</Ui>
                </summary>
                <Prose source={work.description} input={input} />
              </details>
            ) : null}
            <p className="sx-doc__tb" data-type-role="caption">
              {present(work.publication) ? <span>{work.publication}</span> : null}
              {work.publishedAt ? <When raw={work.publishedAt} input={input} /> : null}
              {work.readingTimeMinutes ? (
                <span data-type-role="numeric">{figure(work.readingTimeMinutes, input)} min</span>
              ) : null}
              {work.tags?.length ? <span>{work.tags.filter(present).join(', ')}</span> : null}
            </p>
          </article>
          {work.readingTimeMinutes ? (
            <Dimension axis="v" decorative className="sx-doc__dim" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Episodes({ works, input }: { works: readonly Work[]; input: VariantRenderInput }) {
  const { t, lang } = words(input);
  return (
    <table className="sx-table sx-sched">
      <thead data-type-role="label">
        <tr>
          <th scope="col">
            <Ui lang={lang}>{t.no}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{t.episode}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{t.released}</Ui>
          </th>
          <th scope="col" className="sx-num">
            <Ui lang={lang}>{t.length}</Ui>
          </th>
        </tr>
      </thead>
      <tbody data-type-role="body-compact">
        {works.map((work) => (
          <tr key={work.id} lang={work.lang}>
            <td className="sx-rev" data-type-role="numeric">
              {work.number ?? ''}
            </td>
            <th scope="row">
              <span className="sx-row-title">
                {(work.audioUrl ?? work.url) ? (
                  <Port href={hrefFor((work.audioUrl ?? work.url)!, input)}>{work.title}</Port>
                ) : (
                  work.title
                )}
              </span>
              {present(work.description) ? (
                <span className="sx-row-body">
                  <Phrase source={work.description} input={input} />
                </span>
              ) : null}
              {present(work.series) || work.guests?.length ? (
                <span className="sx-row-body sx-muted">
                  {present(work.series) ? work.series : null}
                  {present(work.series) && work.guests?.length ? '. ' : null}
                  {work.guests?.length ? (
                    <>
                      <Ui lang={lang}>{t.guests}</Ui> {work.guests.filter(present).join(', ')}
                    </>
                  ) : null}
                </span>
              ) : null}
              {present(work.showNotes) ? (
                <details className="sx-abstract">
                  <summary data-type-role="label">
                    <Ui lang={lang}>{t.showNotes}</Ui>
                  </summary>
                  <Prose source={work.showNotes} input={input} />
                </details>
              ) : null}
              {work.links?.length ? (
                <span className="sx-row-body sx-links">
                  {work.links.map((link) => (
                    <Port key={link.url} href={hrefFor(link.url, input)}>
                      {linkLabel(link)}
                    </Port>
                  ))}
                </span>
              ) : null}
            </th>
            <td className="sx-nowrap">
              {work.publishedAt ? <When raw={work.publishedAt} input={input} /> : null}
            </td>
            <td className="sx-num" data-type-role="numeric">
              {work.durationMinutes ? `${figure(work.durationMinutes, input)} min` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Photos({
  works,
  input,
  fig,
}: {
  works: readonly Work[];
  input: VariantRenderInput;
  fig: number;
}) {
  const { t, lang } = words(input);
  return (
    <div className="sx-photos">
      {works.map((work, w) =>
        (work.media ?? (work.cover ? [work.cover] : [])).map((placement, i) => {
          const placed = placedImage(placement, input, undefined);
          if (!placed) return null;
          const ctx = renderContext(input, { id: work.id, title: undefined }, 3);
          return (
            <figure key={`${work.id}-${i}`} className="sx-photo">
              <MediaFigure
                placed={{ ...placed, caption: undefined }}
                ctx={ctx}
                sizes="(min-width: 64rem) 33vw, 100vw"
                inline
              />
              <figcaption data-type-role="body-compact">
                <span className="sx-photo__no" data-type-role="label">
                  <Ui lang={lang}>{t.fig}</Ui>&nbsp;{fig + w}.{i + 1}
                </span>{' '}
                {present(placement.caption) ? (
                  <Phrase source={placement.caption} input={input} />
                ) : (
                  work.title
                )}
                {present(placement.location) || placement.tags?.length ? (
                  <span className="sx-muted">
                    {'. '}
                    {[placement.location, ...(placement.tags ?? [])].filter(present).join(', ')}
                  </span>
                ) : null}
              </figcaption>
            </figure>
          );
        }),
      )}
    </div>
  );
}

function Tracks({
  works,
  input,
  fig,
  level,
}: {
  works: readonly Work[];
  input: VariantRenderInput;
  fig: number;
  level: SectionRendererProps<unknown>['level'];
}) {
  const { t, lang } = words(input);
  const Heading = `h${deeper(level)}` as 'h4';
  return (
    <>
      {works.map((work, w) => {
        const tracks = work.tracks ?? [];
        const timed = tracks.every((track) => (track.durationSeconds ?? 0) > 0);
        const total = timed ? tracks.reduce((a, track) => a + track.durationSeconds!, 0) : 0;
        // On a phone the tracks stack, each dimension drawn to its share of the longest.
        const longest = timed ? Math.max(...tracks.map((track) => track.durationSeconds!)) : 1;
        const id = ownId(input.ids.prefix, `fig-${fig + w}`);
        return (
          <figure key={work.id} className="sx-record" aria-labelledby={`${id}--c`} lang={work.lang}>
            <div className="sx-record__head">
              <Heading data-type-role="title">{work.title}</Heading>
              <p className="sx-muted" data-type-role="body-compact">
                {[work.artist, work.label, work.role].filter(present).join(', ')}
                {work.releasedAt ? (
                  <>
                    {' '}
                    <When raw={work.releasedAt} input={input} />
                  </>
                ) : null}
              </p>
              {present(work.description) ? (
                <p data-type-role="body-compact">
                  <Phrase source={work.description} input={input} />
                </p>
              ) : null}
              {work.links?.length ? (
                <p className="sx-links" data-type-role="body-compact">
                  {work.links.map((link) => (
                    <Port key={link.url} href={hrefFor(link.url, input)}>
                      {linkLabel(link)}
                    </Port>
                  ))}
                </p>
              ) : null}
            </div>
            {timed && tracks.length ? (
              <Dimension decorative>{`${mmss(total)} ${t.inAll}`}</Dimension>
            ) : null}
            {tracks.length ? (
              <ol
                className="sx-chain"
                role="list"
                style={
                  timed
                    ? ({
                        '--layout-chain': tracks
                          .map((track) => `${track.durationSeconds}fr`)
                          .join(' '),
                      } as CSSProperties)
                    : undefined
                }
              >
                {tracks.map((track, i) => (
                  <li
                    key={i}
                    style={
                      timed
                        ? ({
                            '--layout-share': `${((track.durationSeconds! / longest) * 100).toFixed(2)}%`,
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    <span className="sx-chain__label" data-type-role="body-compact">
                      {track.url ? (
                        <Port href={hrefFor(track.url, input)}>{track.title}</Port>
                      ) : (
                        track.title
                      )}
                    </span>
                    <span className="sx-chain__value" data-type-role="numeric">
                      {i + 1}
                      {track.durationSeconds ? (
                        <span className="sx-muted"> {mmss(track.durationSeconds)}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            <Caption id={`${id}--c`} n={fig + w} lang={lang} fig={t.fig}>
              {timed && tracks.length ? t.toScale : null}
            </Caption>
          </figure>
        );
      })}
    </>
  );
}

export function WorksRenderer({ section, input, level }: SectionRendererProps<SectionOf<'works'>>) {
  const works = worksOf(section, input);
  const fig = sheetSet(input).viewOf.get(section.id)?.fig ?? 0;
  switch (workForm(works)) {
    case 'essays':
      return <Essays works={works} input={input} level={level} />;
    case 'episodes':
      return <Episodes works={works} input={input} />;
    case 'photos':
      return <Photos works={works} input={input} fig={fig} />;
    case 'record':
      return <Tracks works={works} input={input} fig={fig} level={level} />;
    default:
      return <Drawings works={works} input={input} level={level} fig={fig} />;
  }
}
