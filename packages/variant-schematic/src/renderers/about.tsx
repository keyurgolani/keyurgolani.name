import {
  hrefFor,
  MediaFigure,
  placedImage,
  renderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { linkLabel, outbound, present } from '../model';
import { Phrase, Port, Prose, Ui, When, words } from '../parts';

// The About sheet's forms and the general notes (brief §5.4, step 7): the
// lede as a specification, Now as a revision cloud with its delta tag,
// focus as open items, fun facts as flag notes, a quotation referenced, a
// custom section as a general note. Prose is in the body role (SC-M5).

type AboutKind = 'lede' | 'now' | 'focus' | 'fun-facts' | 'quote' | 'custom' | 'cta' | 'contact';
type Props<K extends AboutKind> = SectionRendererProps<SectionOf<K>>;

export function LedeRenderer({ section, input }: Props<'lede'>) {
  // On a phone the lede keeps its first paragraph and folds the rest behind
  // their count, a phone fold like Fig. 1's depth: open in the markup,
  // closed at load below 48rem, no control past a phone (P2 page length).
  const { t, lang } = words(input);
  const parts = section.body.split(/\n\s*\n/).filter((part) => part.trim() !== '');
  if (parts.length < 2) return <Prose source={section.body} input={input} className="sx-spec" />;
  return (
    <div className="sx-lede-run">
      <Prose source={parts[0]!} input={input} className="sx-spec" />
      <details className="sx-run-on" open data-sx-fold="lede">
        <summary className="sx-run-on__sum" data-type-role="label">
          <Ui lang={lang}>{t.moreParagraphs(parts.length - 1)}</Ui>
        </summary>
        <Prose source={parts.slice(1).join('\n\n')} input={input} className="sx-spec" />
      </details>
    </div>
  );
}

export function NowRenderer({ section, input }: Props<'now'>) {
  const { t, lang } = words(input);
  return (
    <div className="sx-cloud">
      {present(section.asOf) ? (
        <p className="sx-delta" data-type-role="label">
          <span className="sx-delta__mark" aria-hidden="true" />
          <Ui lang={lang}>{t.revisedOn}</Ui> <When raw={section.asOf} input={input} />
        </p>
      ) : null}
      <Prose source={section.body} input={input} />
    </div>
  );
}

export function FocusRenderer({ section, input }: Props<'focus'>) {
  return (
    <ul className="sx-holds" role="list" data-type-role="body">
      {section.items.filter(present).map((item, i) => (
        <li key={i}>
          <Phrase source={item} input={input} />
        </li>
      ))}
    </ul>
  );
}

export function FunFactsRenderer({ section, input }: Props<'fun-facts'>) {
  return (
    <ol className="sx-flags" role="list" data-type-role="body">
      {section.items.filter(present).map((item, i) => (
        <li key={i}>
          <span className="sx-flag" aria-hidden="true">
            {i + 1}
          </span>
          <span>
            <Phrase source={item} input={input} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function QuoteRenderer({ section, input }: Props<'quote'>) {
  const by = [section.attribution, section.source].filter(present);
  return (
    <figure className="sx-quote">
      <blockquote data-type-role="quote">
        <p>
          <Phrase source={section.text} input={input} />
        </p>
      </blockquote>
      {by.length ? (
        <figcaption data-type-role="body-compact">
          {present(section.attribution) ? section.attribution : null}
          {present(section.attribution) && present(section.source) ? ', ' : null}
          {present(section.source) ? (
            section.sourceUrl ? (
              <Port href={hrefFor(section.sourceUrl, input)}>{section.source}</Port>
            ) : (
              <cite>{section.source}</cite>
            )
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function CustomRenderer({ section, input }: Props<'custom'>) {
  return (
    <div className="sx-note-block">
      {present(section.body) ? <Prose source={section.body} input={input} /> : null}
      {section.items?.length ? (
        <ul className="sx-items" role="list">
          {section.items.map((item, i) => (
            <li key={i}>
              <p data-type-role="title">{item.title}</p>
              {present(item.summary) ? <Prose source={item.summary} input={input} /> : null}
              {(item.media ?? []).map((placement, m) => {
                const placed = placedImage(placement, input, undefined);
                return placed || present(placement.caption) ? (
                  <figure key={m} className="sx-photo">
                    {placed ? (
                      <MediaFigure
                        placed={{ ...placed, caption: undefined }}
                        ctx={renderContext(input, { id: section.id, title: undefined }, 3)}
                        sizes="(min-width: 64rem) 33vw, 100vw"
                        inline
                      />
                    ) : null}
                    {present(placement.caption) ? (
                      <figcaption data-type-role="body-compact">
                        <Phrase source={placement.caption} input={input} />
                      </figcaption>
                    ) : null}
                  </figure>
                ) : null;
              })}
              {item.links?.length ? (
                <p className="sx-links" data-type-role="body-compact">
                  {item.links.map((link) => (
                    <Port key={link.url} href={hrefFor(link.url, input)}>
                      {linkLabel(link)}
                    </Port>
                  ))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CtaRenderer({ section, input }: Props<'cta'>) {
  return (
    <div className="sx-request">
      {present(section.description) ? (
        <p data-type-role="body">
          <Phrase source={section.description} input={input} />
        </p>
      ) : null}
      {section.primaryAction || section.secondaryAction ? (
        <p className="sx-actions">
          {section.primaryAction ? (
            <a
              className="sx-btn sx-btn--primary"
              href={hrefFor(section.primaryAction.url, input)}
              data-type-role="label"
            >
              {section.primaryAction.label}
            </a>
          ) : null}
          {section.secondaryAction ? (
            <a
              href={hrefFor(section.secondaryAction.url, input)}
              data-out={outbound(section.secondaryAction.url) ? '' : undefined}
              data-type-role="body"
            >
              {section.secondaryAction.label}
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export function ContactRenderer({ input }: Props<'contact'>) {
  const { contact, identity, links } = input.portfolio;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const all = [...(contact?.links ?? []), ...links];
  const seen = new Set<string>();
  const shown = all.filter((link) => !seen.has(link.url) && (seen.add(link.url), true));
  return (
    <div className="sx-end">
      {present(contact?.message) ? (
        <p data-type-role="body">
          <Phrase source={contact.message} input={input} />
        </p>
      ) : null}
      {email ? (
        <p className="sx-end__mail" data-type-role="headline">
          <a href={`mailto:${email}`}>
            {email.includes('@') ? (
              <>
                {email.slice(0, email.indexOf('@') + 1)}
                <wbr />
                {email.slice(email.indexOf('@') + 1)}
              </>
            ) : (
              email
            )}
          </a>
        </p>
      ) : null}
      {shown.length ? (
        <ul className="sx-end__links" role="list" data-type-role="body-compact">
          {shown.map((link) => (
            <li key={link.url}>
              <Port href={hrefFor(link.url, input)}>{linkLabel(link)}</Port>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
