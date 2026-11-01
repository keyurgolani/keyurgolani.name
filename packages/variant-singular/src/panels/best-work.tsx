import { MediaFigure, placedImage, renderContext } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { listAnd, planOf, present, proofOf, squash, type Panel } from '../model';
import { Phrase, uiLang, When, Words } from '../parts';
import { headingId, PanelShell } from './panel';

// Panel 2, Best work (brief §5.7): the one work on the ink ground, alone
// (N8: "Singular: panel 2"), its title the panel's display line, its own
// words, up to three lines of proof on hairlines, and who made it with
// what; its cover fills the other half of the grid. With no cover the text
// takes the wider track, so no frame stands empty (F7). The answer is one
// work, whole in itself, so the panel's body is its article.

export function BestWorkPanel({ input, panel }: { input: VariantRenderInput; panel: Panel }) {
  const work = planOf(input).best!;
  const lang = uiLang(input.portfolio.locale);
  const ctx = renderContext(input, { id: work.id, title: work.title }, 2);
  const cover = placedImage(work.cover ?? work.media?.[0], input);
  const summary = [work.summary, work.description, work.excerpt].find(present);
  const proof = proofOf(input, work);
  const tools = (work.tools ?? []).filter(present).map(squash);
  return (
    <PanelShell
      input={input}
      panel={panel}
      body="article"
      className={cover ? 'sg-best' : 'sg-best sg-best--text'}
    >
      <div className="sg-best__text">
        <h2
          className="sg-best__title"
          id={headingId(input, panel)}
          tabIndex={-1}
          data-sg-heading=""
          data-type-role="display"
          lang={work.lang}
          data-sg-rise="lead"
        >
          {squash(work.title)}
        </h2>
        {summary ? (
          <p className="sg-best__summary" data-type-role="title" data-sg-rise="support">
            <Phrase source={summary} input={input} />
          </p>
        ) : null}
        {proof.length > 0 ? (
          <ul className="sg-best__proof" role="list" data-type-role="title" data-sg-rise="support">
            {proof.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {present(work.role) || tools.length > 0 ? (
          <p className="sg-best__meta" data-type-role="body" data-sg-rise="meta">
            {present(work.role) ? (
              <span>
                {squash(work.role)}
                {work.period?.start ? (
                  <>
                    {' '}
                    <Words lang={lang}>since</Words> <When raw={work.period.start} input={input} />
                  </>
                ) : null}
                .
              </span>
            ) : null}
            {present(work.role) && tools.length > 0 ? ' ' : null}
            {tools.length > 0 ? (
              <span>
                <Words lang={lang}>Made with</Words> {listAnd(tools)}.
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      {cover ? (
        <div className="sg-best__media" data-sg-rise="support">
          <MediaFigure placed={cover} ctx={ctx} eager sizes="(min-width: 48rem) 50vw, 100vw" />
        </div>
      ) : null}
    </PanelShell>
  );
}
