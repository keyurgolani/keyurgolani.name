import {
  footerOutline,
  hrefFor,
  LabeledDate,
  MaybeLink,
  placedMedia,
  present,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { Env } from '../env';
import { Address, Figure, Words } from '../parts';

// The owner's own words: a lede, what they're doing now, what they're
// focused on, things about them, a quote, the way to reach them, a call to
// action, and a custom section. In a band they read on the text column; in
// a band's margin, the same content, set small.

/**
 * A body's first paragraph and the rest, when it opens on a plain paragraph
 * and has more; undefined when it doesn't, or when a split could break it
 * (a code fence, or a reference or footnote defined further down).
 */
export function firstParagraph(body: string): { first: string; rest: string } | undefined {
  if (/^ {0,3}(```|~~~|\[[^\]]+\]:)/m.test(body)) return undefined;
  const blocks = body.trim().split(/\n[ \t]*\n/);
  const first = blocks[0]!;
  if (blocks.length < 2 || /^ {0,3}([#>|<-]|[*+] |\d+[.)] )/.test(first)) return undefined;
  return { first, rest: blocks.slice(1).join('\n\n') };
}

/**
 * The owner's account. On one column it reads its first paragraph, the rest
 * behind "Read more" (OWN-7); beside the head column, in print, and to a
 * fragment link inside it, it reads whole. Nothing leaves the page.
 */
export function LedeBody({
  section,
  input,
  env,
}: SectionRendererProps<SectionOf<'lede'>> & { readonly env: Env }) {
  const split = env.place === 'band' ? firstParagraph(section.body) : undefined;
  if (!split) return <RichText source={section.body} className="ee-prose" input={input} />;
  return (
    <div className="ee-prose">
      <RichText source={split.first} className="ee-prose" input={input} />
      <details className="ee-more">
        <summary className="ee-band__fold-summary" data-type-role="body-compact">
          <span className="ee-archive__cue" aria-hidden="true" />{' '}
          <Words input={input}>Read more</Words>
        </summary>
        <RichText source={split.rest} className="ee-prose" input={input} />
      </details>
    </div>
  );
}

export function NowBody({ section, input, level }: SectionRendererProps<SectionOf<'now'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <div className="ee-now">
      {section.asOf !== undefined ? (
        <p className="ee-now__as-of" data-type-role="body-compact">
          <LabeledDate label="As of" raw={section.asOf} ctx={ctx} />
        </p>
      ) : null}
      <RichText source={section.body} className="ee-prose" input={input} />
    </div>
  );
}

/** Focus and things about them: a ruled list, one line each. */
export function ShortListBody({
  section,
}: SectionRendererProps<SectionOf<'focus'> | SectionOf<'fun-facts'>>) {
  return (
    <ul className="ee-ruled" role="list">
      {section.items.filter(present).map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function QuoteBody({ section, input }: SectionRendererProps<SectionOf<'quote'>>) {
  const url = section.sourceUrl;
  const cite = url !== undefined ? hrefFor(url, input) : undefined;
  const source = present(section.source) ? section.source : undefined;
  const attribution = present(section.attribution) ? section.attribution : undefined;
  return (
    <figure className="ee-pull">
      <blockquote cite={cite} className="ee-pull__text">
        <p>{section.text}</p>
      </blockquote>
      {attribution !== undefined || source !== undefined ? (
        <figcaption className="ee-attrib" data-type-role="body-compact">
          {attribution !== undefined ? <b>{attribution}</b> : null}
          {attribution !== undefined && source !== undefined ? ', ' : null}
          {source !== undefined ? (
            <cite>{cite !== undefined ? <a href={cite}>{source}</a> : source}</cite>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * The ways to reach the owner, as the kit's footer outline reads them: the
 * contact record's message, the email once, set large, and the links in a
 * line, the contact record's when it has any, else the portfolio's, none of
 * them the email or the call to action already reaches. The issue's one
 * closing block: the colophon after it repeats none of this (EE-S2).
 */
export function ContactBody({ input }: SectionRendererProps<SectionOf<'contact'>>) {
  const footer = footerOutline(input);
  const links = footer.contact?.links.length ? footer.contact.links : footer.links;
  return (
    <div className="ee-contact">
      {present(footer.contact?.message) ? (
        <p className="ee-contact__message" data-type-role="quote">
          {footer.contact.message}
        </p>
      ) : null}
      {footer.email ? (
        <p className="ee-contact__mail" data-type-role="headline">
          <a href={footer.email.href}>
            <Address email={footer.email.text} />
          </a>
        </p>
      ) : null}
      {links.length > 0 ? (
        <ul className="ee-links" role="list">
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href} data-platform={link.platform}>
                {link.text}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A call to action, as a note: its line and one text link, the primary
 * action's, else the secondary's. The issue sets no card and no button here:
 * the email and the résumé are already a step away (EE-S2).
 */
export function CtaBody({ section, input }: SectionRendererProps<SectionOf<'cta'>>) {
  const link = section.primaryAction ?? section.secondaryAction;
  return (
    <div className="ee-cta">
      {present(section.description) ? <p>{section.description}</p> : null}
      {link ? (
        <p>
          <a href={hrefFor(link.url, input)}>
            {[link.label, link.platform].find(present) ?? link.url}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** A custom section: the owner's body, then each item as a row with its summary and links. */
export function CustomBody({ section, input, level }: SectionRendererProps<SectionOf<'custom'>>) {
  const ctx = renderContext(input, section, level);
  const Heading = `h${ctx.itemLevel}` as const;
  return (
    <>
      {present(section.body) ? (
        <RichText source={section.body} className="ee-prose" input={input} />
      ) : null}
      {section.items?.length ? (
        <ul className="ee-rows" role="list">
          {section.items.map((item, index) => (
            <li key={index} className="ee-row">
              <div className="ee-row__line">
                <Heading className="ee-row__title">{item.title}</Heading>
              </div>
              {present(item.summary) ? (
                <div className="ee-row__note" data-type-role="body-compact">
                  <RichText source={item.summary} input={input} />
                </div>
              ) : null}
              {item.media?.length ? (
                <div className="ee-row__body ee-gallery">
                  {item.media.map((placement, mediaIndex) => {
                    const placed = placedMedia(placement, ctx);
                    return placed ? (
                      <Figure
                        key={mediaIndex}
                        placed={placed}
                        ctx={ctx}
                        className="ee-media"
                        sizes="(min-width: 81.25rem) 20rem, 100vw"
                      />
                    ) : null;
                  })}
                </div>
              ) : null}
              {item.links?.length ? (
                <div className="ee-row__sub" data-type-role="body-compact">
                  <ul className="ee-links" role="list">
                    {item.links.map((link, linkIndex) => (
                      <li key={linkIndex}>
                        <MaybeLink url={link.url} ctx={ctx}>
                          {[link.label, link.platform].find(present) ?? link.url}
                        </MaybeLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
