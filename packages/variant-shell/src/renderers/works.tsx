import type { Work } from '@portfolio/schema';
import {
  formatNames,
  MediaFigure,
  placedImage,
  placedMedia,
  renderContext,
  RichText,
  worksOf,
  type SectionOf,
  type SectionRenderer,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { listingOf, worksForm, type ListingRow } from '../model';
import { Link, Sr, uiLangOf, When, Words, workHref } from '../parts';
import { More, workParts } from './more';

// Works (brief §5.6): `ls -l` for a mixed listing, `ls -lt` for one that's
// all writing, `open` for one that's all image series. In a long listing
// `d` marks a work with its own page; the signature work gets a 36-cell
// imgcat preview and a star, a featured work with a cover a 20-cell
// thumbnail and a hollow star; archived works are dimmed and say so;
// highlights print verbatim in brackets. The record line carries who and
// where (role, artist, series, label, guests, tools); the longer text (an
// excerpt, the notes, the tracks) sits in the row's fold.

function Entry({
  row,
  input,
  ctx,
}: {
  row: ListingRow;
  input: VariantRenderInput;
  ctx: ReturnType<typeof renderContext>;
}) {
  const { work, flag, date, mark, archived, highlights } = row;
  const uiLang = uiLangOf(input);
  const href = workHref(input, work.id);
  const cover = mark ? placedImage(work.cover, input) : undefined;
  const preview = cover ? (mark === 'signature' ? 'sig' : 'thumb') : undefined;
  const meta = [
    work.role,
    work.artist,
    work.series,
    work.label,
    work.guests?.length ? formatNames(work.guests, ctx) : undefined,
    (work.tools ?? []).join(', '),
  ].filter((part): part is string => part !== undefined && part.trim() !== '');
  const links = [
    ...(work.links ?? []).map((link) => ({
      url: link.url,
      text: link.label ?? link.platform ?? link.url,
    })),
    ...(work.url ? [{ url: work.url, text: 'Open' }] : []),
  ];
  return (
    <li
      className="sh-ent"
      data-preview={preview}
      data-archived={archived ? '' : undefined}
      data-id={work.id}
      lang={work.lang}
    >
      <span className="sh-ent__t" aria-hidden="true">
        {flag}
      </span>
      <span className="sh-ent__date">{date ? <When raw={date} /> : null}</span>
      <div className="sh-ent__body">
        <p className="sh-ent__name">
          {href ? (
            <a className="sh-ent__nm sh-dir" href={href}>
              {work.title}
              <span aria-hidden="true">/</span>
            </a>
          ) : (
            <span className="sh-ent__nm">{work.title}</span>
          )}
          {mark === 'signature' ? (
            <span className="sh-ent__star">
              <span aria-hidden="true">★</span>
              <Sr lang={uiLang}> (signature work)</Sr>
            </span>
          ) : mark === 'featured' ? (
            <span className="sh-ent__star">
              <span aria-hidden="true">☆</span>
              <Sr lang={uiLang}> (featured)</Sr>
            </span>
          ) : null}
          {archived ? (
            <span className="sh-faint">
              <Words lang={uiLang}>archived</Words>
            </span>
          ) : null}
          <span className="sh-ent__med">{work.medium}</span>
        </p>
        {/* imgcat, under the name: every row's columns start on the same cells. */}
        {cover ? (
          <div className="sh-icat">
            <MediaFigure
              placed={cover}
              ctx={ctx}
              eager={mark === 'signature'}
              sizes={
                mark === 'signature'
                  ? '(max-width: 47.99rem) 60vw, 36ch'
                  : '(max-width: 47.99rem) 60vw, 20ch'
              }
            />
          </div>
        ) : null}
        {work.summary ? (
          <p className="sh-ent__sum">
            <RichText source={work.summary} inline input={input} />
          </p>
        ) : null}
        {highlights.length > 0 ? (
          <ul className="sh-figs">
            {highlights.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        ) : null}
        {meta.length > 0 ? (
          <p className="sh-ent__meta">
            {meta.map((part, i) => (
              <span key={i}>{part}</span>
            ))}
          </p>
        ) : null}
        <More parts={workParts(work, ctx)} uiLang={uiLang} of={work.title} />
        {links.length > 0 || href ? (
          <p className="sh-ent__links">
            {href ? (
              <a className="sh-btn" href={href}>
                <span className="sh-btn__ang" aria-hidden="true">
                  &lt;
                </span>
                <span className="sh-btn__label">
                  <Words lang={uiLang}>Read the case study</Words>
                </span>
                <span className="sh-btn__ang" aria-hidden="true">
                  &gt;
                </span>
              </a>
            ) : null}
            {links.map((link) => (
              <Link key={link.url} url={link.url} input={input}>
                {link.text === 'Open' ? <Words lang={uiLang}>Open</Words> : link.text}
              </Link>
            ))}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** `ls -lt`: writing as a dated table, newest first as the owner ordered it, with reading time. */
function TimeListing({
  works,
  input,
  ctx,
}: {
  works: readonly Work[];
  input: VariantRenderInput;
  ctx: ReturnType<typeof renderContext>;
}) {
  const uiLang = uiLangOf(input);
  const rows = listingOf(works, input);
  return (
    <>
      <p className="sh-total" lang={uiLang}>
        total {works.length}
      </p>
      <table className="sh-tab">
        <thead>
          <tr lang={uiLang}>
            <th>Published</th>
            <th>Reading time</th>
            <th>Title</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ work, date, mark }) => {
            const href = workHref(input, work.id) ?? work.url;
            return (
              <tr key={work.id} lang={work.lang}>
                <td className="sh-tab__d">{date ? <When raw={date} /> : null}</td>
                <td className="sh-tab__f">
                  {work.readingTimeMinutes ? (
                    <Words lang={uiLang}>{`${work.readingTimeMinutes} min`}</Words>
                  ) : null}
                </td>
                <td className="sh-tab__wide">
                  {href ? (
                    <Link url={href} input={input} className="sh-tab__ttl">
                      {work.title}
                    </Link>
                  ) : (
                    <span className="sh-tab__ttl">{work.title}</span>
                  )}
                  {mark ? (
                    <span className="sh-ent__star">
                      <span aria-hidden="true">{mark === 'signature' ? ' ★' : ' ☆'}</span>
                      <Sr lang={uiLang}>
                        {mark === 'signature' ? ' (signature work)' : ' (featured)'}
                      </Sr>
                    </span>
                  ) : null}
                  {work.summary ? (
                    <span className="sh-tab__desc">
                      <RichText source={work.summary} inline input={input} />
                    </span>
                  ) : null}
                  {work.publication || work.tags?.length ? (
                    <span className="sh-tab__desc sh-faint">
                      {[work.publication, ...(work.tags ?? []).map((tag) => `#${tag}`)]
                        .filter(Boolean)
                        .join('  ')}
                    </span>
                  ) : null}
                  <More parts={workParts(work, ctx)} uiLang={uiLang} of={work.title} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** `open <id>/`: each image in whole cells, with its file name, caption, and place and date. */
function OpenDirectory({
  works,
  ctx,
}: {
  works: readonly Work[];
  ctx: ReturnType<typeof renderContext>;
}) {
  const figures = works.flatMap((work) =>
    [work.cover, ...(work.media ?? [])]
      .filter((placement) => placement !== undefined)
      .map((placement, i) => ({ key: `${work.id}-${i}`, placed: placedMedia(placement, ctx) })),
  );
  const shown = figures.filter(
    (figure): figure is { key: string; placed: NonNullable<typeof figure.placed> } =>
      figure.placed !== undefined,
  );
  return (
    <div className="sh-imgs">
      {shown.map(({ key, placed }) => (
        <div className="sh-icat" key={key}>
          <MediaFigure placed={placed} ctx={ctx} sizes="30ch" />
        </div>
      ))}
    </div>
  );
}

export const LsWorks: SectionRenderer<SectionOf<'works'>> = ({ section, input, level }) => {
  const works = worksOf(section, input);
  const ctx = renderContext(input, section, level);
  const form = worksForm(works);
  if (form === 'ls-time') return <TimeListing works={works} input={input} ctx={ctx} />;
  if (form === 'open') return <OpenDirectory works={works} ctx={ctx} />;
  const uiLang = uiLangOf(input);
  return (
    <>
      <p className="sh-total" lang={uiLang}>
        total {works.length}
      </p>
      <ol className="sh-ls">
        {listingOf(works, input).map((row) => (
          <Entry key={row.work.id} row={row} input={input} ctx={ctx} />
        ))}
      </ol>
    </>
  );
};
