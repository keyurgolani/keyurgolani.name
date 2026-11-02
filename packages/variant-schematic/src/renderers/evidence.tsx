import type { CSSProperties } from 'react';
import type { Evidence } from '@portfolio/schema';
import {
  deeper,
  evidenceOf,
  hrefFor,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Balloon, Dimension } from '../drawing/dimension';
import { evidenceForm, linkLabel, monthsBetween, present, sheetSet } from '../model';
import { Caption, figure, ownId, Phrase, Port, Ui, When, words } from '../parts';

// Evidence (brief §5.4, step 7), one drawing convention per type: metrics
// as a chain dimension "not to scale", each value in its own unit;
// publications as referenced documents; talks as a schedule; press as
// inspection reports; testimonials as a sign-off block; awards as
// certificates; patents with the filed-to-granted span dimensioned; work
// elsewhere as related drawing sets; anything mixed as a references list.

type Level = SectionRendererProps<unknown>['level'];

function Chain({
  entries,
  input,
  fig,
}: {
  entries: readonly Evidence[];
  input: VariantRenderInput;
  fig: number;
}) {
  const { t, lang } = words(input);
  const { noteOf } = sheetSet(input);
  const id = ownId(input.ids.prefix, `fig-${fig}`);
  return (
    <figure className="sx-metrics" aria-labelledby={`${id}--c`}>
      <dl
        className="sx-chain"
        style={{ '--layout-chain': `repeat(${entries.length}, minmax(0, 1fr))` } as CSSProperties}
      >
        {entries.map((entry) => {
          const note = noteOf.get(entry.id);
          return (
            <div key={entry.id} lang={entry.lang}>
              <dt className="sx-chain__label" data-type-role="body-compact">
                {present(entry.statement) ? (
                  <Phrase source={entry.statement} input={input} />
                ) : (
                  entry.title
                )}
                {present(entry.description) ? (
                  <span className="sx-muted">
                    {'. '}
                    <Phrase source={entry.description} input={input} />
                  </span>
                ) : null}
                {present(entry.source?.name) ? (
                  <span className="sx-muted">
                    {'. '}
                    <Ui lang={lang}>{t.source}</Ui>{' '}
                    {entry.source.url ? (
                      <Port href={hrefFor(entry.source.url, input)}>{entry.source.name}</Port>
                    ) : (
                      entry.source.name
                    )}
                  </span>
                ) : null}
              </dt>
              <dd className="sx-chain__value" data-type-role="headline">
                {note ? <Balloon n={note} /> : null}
                <span data-type-role="numeric">{figure(entry.metric!.value!, input)}</span>
                {present(entry.metric?.unit) ? (
                  <span className="sx-unit"> {entry.metric!.unit}</span>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
      <Caption id={`${id}--c`} n={fig} lang={lang} fig={t.fig}>
        {t.notToScale}
      </Caption>
    </figure>
  );
}

function References({
  entries,
  input,
  level,
}: {
  entries: readonly Evidence[];
  input: VariantRenderInput;
  level: Level;
}) {
  const { t, lang } = words(input);
  const Heading = `h${deeper(level)}` as 'h4';
  return (
    <ol className="sx-refs" role="list">
      {entries.map((entry, i) => (
        <li key={entry.id} className="sx-ref" lang={entry.lang}>
          <p className="sx-ref__code" data-type-role="label">
            <span>
              [{i + 1}]{present(entry.venue) ? ` ${entry.venue}` : ''}
            </span>
            {entry.publishedAt ? <When raw={entry.publishedAt} input={input} /> : null}
          </p>
          <div>
            <Heading className="sx-ref__title" data-type-role="title">
              {entry.url ? (
                <Port href={hrefFor(entry.url, input)}>{entry.title ?? entry.statement}</Port>
              ) : (
                (entry.title ?? entry.statement)
              )}
            </Heading>
            {entry.authors?.length ? (
              <p className="sx-muted" data-type-role="body-compact">
                {entry.authors.join(', ')}
              </p>
            ) : null}
            {present(entry.abstract) ? (
              <details className="sx-abstract">
                <summary data-type-role="label">
                  <Ui lang={lang}>{t.abstract}</Ui>
                </summary>
                <p data-type-role="body-compact">
                  <Phrase source={entry.abstract} input={input} />
                </p>
              </details>
            ) : null}
            {present(entry.citation) ? (
              <p className="sx-ref__cite" data-type-role="body-compact">
                <span className="sx-field-name" data-type-role="label">
                  <Ui lang={lang}>{t.citation}</Ui>
                </span>{' '}
                <Phrase source={entry.citation} input={input} />
              </p>
            ) : null}
            {entry.awards?.length ? (
              <p className="sx-muted" data-type-role="body-compact">
                <span className="sx-field-name" data-type-role="label">
                  <Ui lang={lang}>{t.awards}</Ui>
                </span>{' '}
                {entry.awards.filter(present).join(', ')}
              </p>
            ) : null}
            {entry.doi || entry.pdfUrl ? (
              <p className="sx-links" data-type-role="body-compact">
                {present(entry.doi) ? <span data-type-role="code">doi:{entry.doi}</span> : null}
                {entry.pdfUrl ? (
                  <Port href={hrefFor(entry.pdfUrl, input)}>
                    <Ui lang={lang}>{t.pdf}</Ui>
                  </Port>
                ) : null}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Schedule({ entries, input }: { entries: readonly Evidence[]; input: VariantRenderInput }) {
  const { t, lang } = words(input);
  return (
    <table className="sx-table sx-sched">
      <thead data-type-role="label">
        <tr>
          <th scope="col">
            <Ui lang={lang}>{t.date}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{t.talk}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{t.venue}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{t.material}</Ui>
          </th>
        </tr>
      </thead>
      <tbody data-type-role="body-compact">
        {entries.map((entry) => (
          <tr key={entry.id} lang={entry.lang}>
            <td className="sx-nowrap">
              {entry.presentedAt ? <When raw={entry.presentedAt} input={input} /> : null}
            </td>
            <th scope="row">
              <span className="sx-row-title">{entry.title ?? entry.statement}</span>
              {present(entry.description) ? (
                <span className="sx-row-body">
                  <Phrase source={entry.description} input={input} />
                </span>
              ) : null}
              {present(entry.abstract) ? (
                <details className="sx-abstract">
                  <summary data-type-role="label">
                    <Ui lang={lang}>{t.abstract}</Ui>
                  </summary>
                  <p data-type-role="body-compact">
                    <Phrase source={entry.abstract} input={input} />
                  </p>
                </details>
              ) : null}
            </th>
            <td>
              {entry.venue}
              {present(entry.location) ? (
                <span className="sx-row-body sx-muted">{entry.location}</span>
              ) : null}
            </td>
            <td>
              {entry.slidesUrl ? (
                <Port href={hrefFor(entry.slidesUrl, input)}>
                  <Ui lang={lang}>{t.slides}</Ui>
                </Port>
              ) : null}
              {entry.slidesUrl && entry.videoUrl ? <br /> : null}
              {entry.videoUrl ? (
                <Port href={hrefFor(entry.videoUrl, input)}>
                  <Ui lang={lang}>{t.video}</Ui>
                </Port>
              ) : null}
              {(entry.links ?? []).map((link, i) => (
                <span key={link.url}>
                  {entry.slidesUrl || entry.videoUrl || i > 0 ? <br /> : null}
                  <Port href={hrefFor(link.url, input)}>{linkLabel(link)}</Port>
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Reports({ entries, input }: { entries: readonly Evidence[]; input: VariantRenderInput }) {
  const { t, lang } = words(input);
  return (
    <ul className="sx-reports" role="list">
      {entries.map((entry) => (
        <li key={entry.id} className="sx-report" lang={entry.lang}>
          <dl className="sx-report__fields" data-type-role="body-compact">
            {present(entry.publication) ? (
              <div>
                <dt data-type-role="label">
                  <Ui lang={lang}>{t.publication}</Ui>
                </dt>
                <dd>{entry.publication}</dd>
              </div>
            ) : null}
            {present(entry.author) ? (
              <div>
                <dt data-type-role="label">
                  <Ui lang={lang}>{t.by}</Ui>
                </dt>
                <dd>{entry.author}</dd>
              </div>
            ) : null}
            {entry.publishedAt ? (
              <div>
                <dt data-type-role="label">
                  <Ui lang={lang}>{t.date}</Ui>
                </dt>
                <dd>
                  <When raw={entry.publishedAt} input={input} />
                </dd>
              </div>
            ) : null}
          </dl>
          {present(entry.excerpt) ? (
            <blockquote data-type-role="body">
              <p>
                <Phrase source={entry.excerpt} input={input} />
              </p>
            </blockquote>
          ) : null}
          <p data-type-role="body-compact">
            {entry.url ? (
              <Port href={hrefFor(entry.url, input)}>{entry.title ?? entry.statement}</Port>
            ) : (
              (entry.title ?? entry.statement)
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

function SignOff({ entries, input }: { entries: readonly Evidence[]; input: VariantRenderInput }) {
  const { t, lang } = words(input);
  return (
    <ul className="sx-signoffs" role="list">
      {entries.map((entry) => (
        <li key={entry.id} lang={entry.lang}>
          <figure className="sx-signoff">
            <blockquote data-type-role="body">
              <p>
                <Phrase source={entry.statement ?? ''} input={input} />
              </p>
            </blockquote>
            <figcaption data-type-role="body-compact">
              <span className="sx-field-name" data-type-role="label">
                <Ui lang={lang}>{t.checked}</Ui>
              </span>
              <b>
                {entry.source?.url ? (
                  <Port href={hrefFor(entry.source.url, input)}>{entry.source.name}</Port>
                ) : (
                  entry.source?.name
                )}
              </b>
              <span className="sx-muted">
                {[entry.source?.role, entry.source?.organization].filter(present).join(', ')}
              </span>
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}

function Certificates({
  entries,
  input,
}: {
  entries: readonly Evidence[];
  input: VariantRenderInput;
}) {
  const { t, lang } = words(input);
  const linked = new Set(sheetSet(input).signature?.evidence ?? []);
  return (
    <ul className="sx-certs" role="list">
      {entries.map((entry) => (
        <li key={entry.id} className="sx-cert" lang={entry.lang}>
          <p className="sx-cert__year" data-type-role="numeric">
            {entry.receivedAt ? <When raw={entry.receivedAt} input={input} /> : null}
          </p>
          <p data-type-role="title">
            {entry.url ? <Port href={hrefFor(entry.url, input)}>{entry.title}</Port> : entry.title}
          </p>
          {present(entry.organization) ? (
            <p className="sx-muted" data-type-role="body-compact">
              {entry.organization}
            </p>
          ) : null}
          {present(entry.description) ? (
            <p data-type-role="body-compact">
              <Phrase source={entry.description} input={input} />
              {linked.has(entry.id) ? (
                <>
                  {' '}
                  <a href={`#${ownId(input.ids.prefix, 'fig-1')}`}>
                    <Ui lang={lang}>{t.fig}&nbsp;1</Ui>
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Patents({ entries, input }: { entries: readonly Evidence[]; input: VariantRenderInput }) {
  const { t, lang } = words(input);
  return (
    <ul className="sx-patents" role="list">
      {entries.map((entry) => {
        const months = monthsBetween(entry.filedAt, entry.grantedAt);
        return (
          <li key={entry.id} className="sx-patent" lang={entry.lang}>
            <p className="sx-muted" data-type-role="label">
              {[entry.number, entry.status].filter(present).join(', ')}
            </p>
            <p data-type-role="title">
              {entry.url ? (
                <Port href={hrefFor(entry.url, input)}>{entry.title}</Port>
              ) : (
                entry.title
              )}
            </p>
            {present(entry.description) ? (
              <p data-type-role="body-compact">
                <Phrase source={entry.description} input={input} />
              </p>
            ) : null}
            {entry.filedAt && entry.grantedAt ? (
              <div className="sx-patent__span" data-type-role="body-compact">
                <span>
                  <Ui lang={lang}>{t.filed}</Ui> <When raw={entry.filedAt} input={input} />
                </span>
                <Dimension decorative>
                  {months !== undefined
                    ? `${Math.floor(months / 12)} y ${months % 12} m`
                    : undefined}
                </Dimension>
                <span>
                  <Ui lang={lang}>{t.granted}</Ui> <When raw={entry.grantedAt} input={input} />
                </span>
              </div>
            ) : null}
            {entry.inventors?.length ? (
              <p className="sx-muted" data-type-role="body-compact">
                {entry.inventors.join(', ')}
                {present(entry.assignee) ? `, ${entry.assignee}` : ''}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Related({ entries, input }: { entries: readonly Evidence[]; input: VariantRenderInput }) {
  return (
    <ul className="sx-related" role="list">
      {entries.map((entry) => (
        <li key={entry.id} lang={entry.lang}>
          <p data-type-role="title">
            {entry.url ? (
              <Port href={hrefFor(entry.url, input)}>{entry.title ?? entry.statement}</Port>
            ) : (
              (entry.title ?? entry.statement)
            )}
          </p>
          {entry.categories?.length || present(entry.locationLabel) ? (
            <p className="sx-muted" data-type-role="label">
              {[...(entry.categories ?? []), entry.locationLabel].filter(present).join(', ')}
            </p>
          ) : null}
          {present(entry.description) ? (
            <p data-type-role="body-compact">
              <Phrase source={entry.description} input={input} />
            </p>
          ) : null}
          {entry.highlights?.length ? (
            <p className="sx-muted" data-type-role="body-compact">
              {entry.highlights.map((h) => `${h.label} ${h.sub}`).join(', ')}
            </p>
          ) : null}
          {entry.url && (present(entry.buttonText) || present(entry.urlLabel)) ? (
            <p className="sx-links" data-type-role="body-compact">
              <Port href={hrefFor(entry.url, input)}>
                {[entry.buttonText, entry.urlLabel].filter(present).join(', ')}
              </Port>
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function List({ entries, input }: { entries: readonly Evidence[]; input: VariantRenderInput }) {
  return (
    <ol className="sx-refs" role="list">
      {entries.map((entry, i) => (
        <li key={entry.id} className="sx-ref" lang={entry.lang}>
          <p className="sx-ref__code" data-type-role="label">
            [{i + 1}]
          </p>
          <div data-type-role="body-compact">
            <p data-type-role="body">
              {entry.url ? (
                <Port href={hrefFor(entry.url, input)}>{entry.title ?? entry.statement}</Port>
              ) : (
                <Phrase source={entry.title ?? entry.statement ?? ''} input={input} />
              )}
            </p>
            {present(entry.title) && present(entry.statement) ? (
              <p>
                <Phrase source={entry.statement} input={input} />
              </p>
            ) : null}
            {present(entry.description) ? (
              <p className="sx-muted">
                <Phrase source={entry.description} input={input} />
              </p>
            ) : null}
            {present(entry.source?.name) || present(entry.location) ? (
              <p className="sx-muted">
                {[
                  entry.source?.name,
                  entry.source?.role,
                  entry.source?.organization,
                  entry.location,
                ]
                  .filter(present)
                  .join(', ')}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function EvidenceRenderer({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'evidence'>>) {
  const entries = evidenceOf(section, input);
  const fig = sheetSet(input).viewOf.get(section.id)?.fig ?? 0;
  switch (evidenceForm(entries)) {
    case 'chain':
      return <Chain entries={entries} input={input} fig={fig} />;
    case 'references':
      return <References entries={entries} input={input} level={level} />;
    case 'schedule':
      return <Schedule entries={entries} input={input} />;
    case 'reports':
      return <Reports entries={entries} input={input} />;
    case 'signoff':
      return <SignOff entries={entries} input={input} />;
    case 'certificates':
      return <Certificates entries={entries} input={input} />;
    case 'patents':
      return <Patents entries={entries} input={input} />;
    case 'related':
      return <Related entries={entries} input={input} />;
    default:
      return <List entries={entries} input={input} />;
  }
}
