import type { Work } from '@portfolio/schema';
import { hrefFor, isRoutedWork, type HeadingLevel } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { Dimension } from '../drawing/dimension';
import {
  depthCount,
  depthOf,
  firstSentence,
  hasDepth,
  interfaceOf,
  present,
  sheetSet,
} from '../model';
import { ownId, Phrase, Port, Prose, Span, Ui, When, words } from '../parts';

// The interface figure (brief §5.4, step 6): every work drawn as a small,
// heavy-lined INTERFACE box whose ports are its real links, beside a dashed
// DEPTH region (the hidden-line convention) holding what it measured, its
// parts and what it cites. IN and OUT arrows meet the box when the content
// derives them; with no ports and no IN/OUT there's no box, and the depth
// spans the figure. Never an image: the drawing is the plate (N8).

export function InterfaceFigure({
  work,
  no,
  input,
  level,
  cover = false,
  full = false,
}: {
  work: Work;
  no: number;
  input: VariantRenderInput;
  level: HeadingLevel;
  cover?: boolean;
  full?: boolean;
}) {
  const { t, lang } = words(input);
  const set = sheetSet(input);
  const plan = interfaceOf(work, input, { full });
  const { ports } = plan;
  // On the work's own page the elevation's paragraph and the test report
  // carry In, Out and the references: Fig. 1 keeps the interface, what it
  // measured and its parts (P2 change 5).
  const io = full ? undefined : plan.io;
  const drawn = depthOf(work, input, set.noteOf);
  const depth = full ? { ...drawn, references: [] } : drawn;
  const drawDepth = hasDepth(depth);
  const id = ownId(input.ids.prefix, `fig-${no}`);
  const Heading = `h${level}` as 'h2';
  // On its own page the figure's title doesn't link to the page it's on.
  const titleHref = full
    ? undefined
    : isRoutedWork(work)
      ? routeHref(input, { route: 'work', slug: work.slug })
      : work.links?.[0]?.url || work.url
        ? hrefFor((work.links?.[0]?.url ?? work.url)!, input)
        : undefined;
  const summary = present(work.summary) ? work.summary : firstSentence(work.description);
  const archived = (input.portfolio.archive ?? []).includes(work.id);
  const medium = t.medium[work.medium];
  return (
    <figure
      className="sx-fig"
      id={id}
      aria-labelledby={`${id}--t`}
      data-cover={cover ? '' : undefined}
      data-plan={`${io ? 'io' : 'noio'} ${ports.length ? 'ports' : 'noports'}`}
    >
      <figcaption className="sx-fig__head">
        <span className="sx-fig__no" data-type-role="label">
          <Ui lang={lang}>{t.fig}</Ui>&nbsp;{no}
        </span>
        <Heading className="sx-fig__title" id={`${id}--t`} data-type-role="title">
          {full ? (
            <Ui lang={lang}>{t.interfaceOf(work.title)}</Ui>
          ) : titleHref ? (
            <a href={titleHref}>{work.title}</a>
          ) : (
            work.title
          )}
        </Heading>
        {/* On its own page the sheet's head already says what the work is and when. */}
        {summary && !full ? (
          <p className="sx-fig__sum" data-type-role="body-compact">
            <Phrase source={summary} input={input} />
          </p>
        ) : null}
        {/* The whole description, folded as a reference's abstract is. On its own page the
            elevation carries it, so the cover's Fig. 1 of a routed work leaves it there. */}
        {present(work.description) && !full && !(cover && isRoutedWork(work)) ? (
          <details className="sx-abstract sx-fig__desc">
            <summary data-type-role="label">
              <Ui lang={lang}>{t.description}</Ui>
            </summary>
            <Prose source={work.description} input={input} />
          </details>
        ) : null}
        {full ? null : (
          <p className="sx-fig__meta" data-type-role="body-compact">
            {medium ? <Ui lang={lang}>{medium}</Ui> : null}
            {work.period ? (
              <span>
                <Span period={work.period} input={input} />
              </span>
            ) : work.releasedAt || work.publishedAt ? (
              <span>
                <When raw={work.releasedAt ?? work.publishedAt} input={input} />
              </span>
            ) : null}
            {present(work.role) ? <span>{work.role}</span> : null}
            {archived ? <Ui lang={lang}>{t.archived}</Ui> : null}
          </p>
        )}
      </figcaption>
      <div className="sx-plan">
        {io ? (
          <dl className="sx-io">
            <div className="sx-io__row" data-io="in">
              <dt data-type-role="label">
                <Ui lang={lang}>{t.in}</Ui>
              </dt>
              <dd data-type-role="body-compact">{io.in}</dd>
            </div>
            <div className="sx-io__row" data-io="out">
              <dt data-type-role="label">
                <Ui lang={lang}>{t.out}</Ui>
              </dt>
              <dd data-type-role="body-compact">{io.out}</dd>
            </div>
          </dl>
        ) : null}
        {ports.length > 0 ? (
          <div className="sx-iface">
            <Dimension decorative delay={1}>
              {t.ports(ports.length)}
            </Dimension>
            <div className="sx-iface__box" data-draw={2}>
              <p className="sx-tag" data-type-role="label">
                <Ui lang={lang}>{t.interface}</Ui>
              </p>
              <ul className="sx-ports" aria-label={t.interfaceOf(work.title)} role="list">
                {ports.map((port) => (
                  <li key={port.href}>
                    <Port href={port.href}>
                      {port.own ? <Ui lang={lang}>{port.label}</Ui> : port.label}
                    </Port>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {drawDepth ? (
          <div className="sx-depth">
            {/* On a phone the depth folds behind its count, as FOLD_KIND folds a
                view: open in the markup, closed at load by the enhancement. */}
            <details className="sx-depth__fold" open data-sx-fold="depth">
              <summary className="sx-depth__sum" data-type-role="label">
                <Ui lang={lang}>{depthCount(depth, input.portfolio.locale) || t.depth}</Ui>
              </summary>
              <div className="sx-depth__inner">
                <Dimension decorative delay={3}>
                  {depthCount(depth, input.portfolio.locale) || undefined}
                </Dimension>
                <div className="sx-depth__box" data-draw={4}>
                  <p className="sx-tag" data-type-role="label">
                    <Ui lang={lang}>{t.depth}</Ui>
                  </p>
                  <div className="sx-depth__cols">
                    {depth.measured.length > 0 ? (
                      <div>
                        <p className="sx-depth__h" data-type-role="label">
                          <Ui lang={lang}>{t.measured}</Ui>
                        </p>
                        <ul className="sx-measured" role="list" data-type-role="body-compact">
                          {depth.measured.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {depth.parts.length > 0 ? (
                      <div className="sx-depth__group" data-col="parts">
                        <p className="sx-depth__h" data-type-role="label">
                          <Ui lang={lang}>{t.parts}</Ui>
                        </p>
                        <p data-type-role="body-compact">{depth.parts.join(', ')}</p>
                      </div>
                    ) : null}
                    {depth.references.length > 0 ? (
                      <div className="sx-depth__group" data-col="refs">
                        <p className="sx-depth__h" data-type-role="label">
                          <Ui lang={lang}>{t.references}</Ui>
                        </p>
                        <ul role="list" data-type-role="body-compact">
                          {depth.references.map((ref) => (
                            <li key={ref.title}>
                              {ref.title}
                              {ref.by.length ? (
                                <span className="sx-muted">, {ref.by.join(', ')}</span>
                              ) : null}
                              {ref.note ? (
                                <span className="sx-muted">
                                  {' '}
                                  (<Ui lang={lang}>{t.notes}</Ui> {ref.note})
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {depth.role ? (
                      <div className="sx-depth__group">
                        <p className="sx-depth__h" data-type-role="label">
                          <Ui lang={lang}>{t.drawnByRole}</Ui>
                        </p>
                        <p data-type-role="body-compact">
                          {depth.role}
                          {work.period ? (
                            <>
                              , <Span period={work.period} input={input} />
                            </>
                          ) : null}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </details>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
