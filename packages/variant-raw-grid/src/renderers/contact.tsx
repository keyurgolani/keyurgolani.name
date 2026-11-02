import type { CSSProperties, ReactNode } from 'react';
import {
  footerOutline,
  Heading,
  present,
  renderContext,
  renderSection,
  sameTarget,
  type FooterOutline,
  type SectionComposition,
  type SectionFrameProps,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { headId } from '../frame';
import { Breakable, Fit, Out } from '../parts';

// The close: one ink block, the page's one closing form (docs/variants.md),
// whose biggest link is the email. The contact section's frame holds it
// all; the call to action beside it renders inside, framed, under the one
// heading: its title opens the message when the contact's title took the
// heading, then its description and the contact's message, then the
// primary action at display size with the address under it, the secondary
// action, and every other way to get in touch, each place once, as
// footerOutline() lists them.

/** Every other way to get in touch, less what the block already reaches. */
function listed(footer: FooterOutline, input: VariantRenderInput) {
  const links = input.portfolio.contact?.links?.length
    ? (footer.contact?.links ?? [])
    : footer.links;
  return links.filter(
    (link) =>
      !(footer.cta?.primary && sameTarget(link.href, footer.cta.primary.href)) &&
      !(footer.cta?.secondary && sameTarget(link.href, footer.cta.secondary.href)) &&
      !(footer.email && sameTarget(link.href, footer.email.href)),
  );
}

/**
 * The block's biggest link: the call to action's, else the identity's email,
 * else an email the contact links list. So an owner whose one way in is an
 * email link still gets the block whole, the address at display size,
 * never a lone small link under the heading.
 */
function bigLink(footer: FooterOutline, input: VariantRenderInput) {
  return (
    footer.cta?.primary ??
    footer.email ??
    listed(footer, input).find((link) => link.href.startsWith('mailto:'))
  );
}

/** Text that is an address, an email's or a site's: no spaces, an @ or a dot. */
const ADDRESS = /^[^\s]+[@.][^\s]+$/;
const SENTENCE = { 'data-case': 'sentence' } as const;

/**
 * The big link's longest word in characters, an address split where Breakable lets it wrap
 * (after the @, before each dot or slash): the name's fit sizes the link by it, so that word
 * always fits its cell.
 */
export function longestPiece(text: string): number {
  const pieces = text.split(/\s+|(?<=@)|(?=[./])/).filter(Boolean);
  return Math.max(1, ...pieces.map((piece) => [...piece].length));
}

/**
 * The big link's fit, in characters. An address by its longest piece, since it wraps at its
 * own points; any other text, a call to action such as "Email me", as a phrase: the whole of
 * it, so it keeps one line, up to sixteen characters, past which it wraps by its words.
 */
export function bigChars(text: string): number {
  const piece = longestPiece(text);
  return ADDRESS.test(text) ? piece : Math.max(piece, Math.min([...text.trim()].length, 16));
}

/** A place on home, from a page that isn't: a fragment leads there. */
const homeward = (href: string, input: VariantRenderInput) =>
  href.startsWith('#') && input.route.route !== 'home'
    ? `${routeHref(input, { route: 'home' })}${href}`
    : href;

/**
 * The ways the list cell shows: every other one, less the big link. The owner's email leads
 * them when the big link is something else, a call to action's own address, so it still shows.
 */
const ways = (footer: FooterOutline, input: VariantRenderInput) => {
  const big = bigLink(footer, input);
  const email =
    footer.email && !(big && sameTarget(footer.email.href, big.href)) ? [footer.email] : [];
  return [...email, ...listed(footer, input)].filter(
    (link) => !(big && sameTarget(link.href, big.href)),
  );
};

/** The ask and the action: the message, the big link, the address, the second action. */
function Ask({
  footer,
  input,
  lead,
  message,
  head,
}: {
  footer: FooterOutline;
  input: VariantRenderInput;
  lead?: string;
  message: readonly string[];
  /** The block's heading, when the big link is all it holds: hung on the link's cell. */
  head?: ReactNode;
}) {
  const primary = bigLink(footer, input);
  const mailed =
    footer.email !== undefined &&
    primary !== undefined &&
    sameTarget(primary.href, footer.email.href);
  const secondary = footer.cta?.secondary;
  return (
    <>
      {lead !== undefined || message.length > 0 ? (
        <div className="rg-cell rg-ink__msg">
          {lead !== undefined ? (
            <p className="rg-ink__lead">
              <Fit text={lead} />
            </p>
          ) : null}
          {message.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </div>
      ) : null}
      {primary || secondary ? (
        <div className={head ? 'rg-cell rg-ink__go rg-ink__go--head' : 'rg-cell rg-ink__go'}>
          {head}
          {primary ? (
            <a className="rg-ink__mail" href={homeward(primary.href, input)}>
              {/* An address keeps its own case: caps are the poster's voice, not the address's. */}
              <span
                className="rg-name rg-ink__big"
                style={{ '--layout-name-chars': bigChars(primary.text) } as CSSProperties}
                {...(ADDRESS.test(primary.text) ? SENTENCE : {})}
              >
                <Breakable text={primary.text} />
              </span>
              {mailed && footer.email!.text !== primary.text ? (
                <span className="rg-ink__addr">
                  <Breakable text={footer.email!.text} />
                </span>
              ) : null}
            </a>
          ) : null}
          {secondary ? (
            <Out className="rg-ink__second" href={homeward(secondary.href, input)}>
              <Fit text={secondary.text} />
            </Out>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** The ways out of the block, as a list cell. */
function Ways({ input, footer }: { input: VariantRenderInput; footer: FooterOutline }) {
  const links = ways(footer, input);
  if (links.length === 0) return null;
  return (
    <ul className="rg-cell rg-ink__links" role="list">
      {links.map((link) => (
        <li key={link.href}>
          <Out
            href={homeward(link.href, input)}
            // A name takes the fit with its mark (an address wraps at its own points instead),
            // so the mark never drops to a line of its own.
            {...(ADDRESS.test(link.text)
              ? { sentence: true }
              : {
                  className: 'rg-name rg-fit',
                  style: {
                    '--layout-name-chars': longestPiece(`${link.text}↗`),
                  } as CSSProperties,
                })}
          >
            <Breakable text={link.text} />
          </Out>
        </li>
      ))}
    </ul>
  );
}

/** The call to action merged under the contact's heading: its frame, holding the ask. */
function mergedCta(
  input: VariantRenderInput,
  footer: FooterOutline,
  takesTitle: boolean,
): SectionComposition {
  const contactMessage = input.portfolio.contact?.message;
  return {
    renderers: {
      // Its subtitle follows its title: under the lead here, or in the head cell when its
      // title is the block's heading.
      cta: ({ section }) => (
        <Ask
          footer={footer}
          input={input}
          {...(takesTitle && present(section.title) ? { lead: section.title } : {})}
          message={[
            takesTitle || !present(section.title) ? section.subtitle : undefined,
            section.description,
            contactMessage,
          ].filter(present)}
        />
      ),
      contact: () => null,
    },
    Frame: ({ frame, children }: SectionFrameProps) => (
      <section {...frame} className="rg-ink__ask">
        {children}
      </section>
    ),
  };
}

export function ContactBody({ section, input, level }: SectionRendererProps<SectionOf<'contact'>>) {
  const footer = footerOutline(input);
  const cta = footer.cta
    ? input.portfolio.sections.find(
        (each): each is SectionOf<'cta'> => each.kind === 'cta' && each.id === footer.cta!.id,
      )
    : undefined;
  const ownTitle = present(section.title);
  const heading = ownTitle ? section.title : cta?.title;
  const ctx = renderContext(input, section, level);
  const tab = present(heading) ? (
    <Heading level={level} className="rg-tab">
      <span id={headIdOf(input, section.id)}>{heading}</span>
    </Heading>
  ) : null;
  if (cta) {
    return (
      <>
        {tab ? (
          <div className="rg-cell rg-ink__head">
            {tab}
            {present(section.subtitle) ? <p className="rg-band__sub">{section.subtitle}</p> : null}
            {!ownTitle && present(cta.title) && present(cta.subtitle) ? (
              <p className="rg-band__sub">{cta.subtitle}</p>
            ) : null}
          </div>
        ) : null}
        {renderSection(cta, input, mergedCta(input, footer, ownTitle), { level: ctx.itemLevel })}
        <Ways input={input} footer={footer} />
      </>
    );
  }
  return (
    <Closing
      footer={footer}
      input={input}
      tab={tab}
      sub={section.subtitle}
      message={[input.portfolio.contact?.message].filter(present)}
    />
  );
}

/**
 * The block's heading cell, the ask and the ways. With only the big link to hold, the
 * heading hangs on the link's cell instead, which then runs the width: no cell for a tab alone.
 */
function Closing({
  footer,
  input,
  tab,
  sub,
  message,
}: {
  footer: FooterOutline;
  input: VariantRenderInput;
  tab: ReactNode;
  sub?: string | undefined;
  message: readonly string[];
}) {
  const alone =
    tab !== null &&
    !present(sub) &&
    message.length === 0 &&
    bigLink(footer, input) !== undefined &&
    ways(footer, input).length === 0;
  return (
    <>
      {tab && !alone ? (
        <div className="rg-cell rg-ink__head">
          {tab}
          {present(sub) ? <p className="rg-band__sub">{sub}</p> : null}
        </div>
      ) : null}
      <Ask footer={footer} input={input} message={message} {...(alone ? { head: tab } : {})} />
      <Ways input={input} footer={footer} />
    </>
  );
}

/** The heading id the ink frame names its section by. */
const headIdOf = (input: VariantRenderInput, id: string) => `${input.ids.prefix}${id}--head`;

/** A call to action with no contact section beside it: the block alone, its title the heading. */
export function CtaBody({ section, input, level }: SectionRendererProps<SectionOf<'cta'>>) {
  const footer = footerOutline(input);
  return (
    <Closing
      footer={footer}
      input={input}
      tab={
        present(section.title) ? (
          <Heading level={level} className="rg-tab">
            <span id={headIdOf(input, section.id)}>{section.title}</span>
          </Heading>
        ) : null
      }
      sub={section.subtitle}
      message={[section.description].filter(present)}
    />
  );
}

/** The heading the block shows: the contact's title, else the call to action's. */
function headingOf(
  section: SectionFrameProps['section'],
  input: VariantRenderInput,
): string | undefined {
  const own = 'title' in section && present(section.title) ? section.title : undefined;
  if (own !== undefined || section.kind !== 'contact') return own;
  const id = footerOutline(input).cta?.id;
  const cta = input.portfolio.sections.find((each) => each.kind === 'cta' && each.id === id);
  return cta && 'title' in cta && present(cta.title) ? cta.title : undefined;
}

/** The ink block's frame: the field the closing sits in, named by its one heading. */
export function inkFrame(input: VariantRenderInput) {
  return function InkFrame(props: SectionFrameProps) {
    return (
      <section
        {...props.frame}
        {...(headingOf(props.section, input) !== undefined
          ? { 'aria-labelledby': headId(props.frame) }
          : {})}
        className="rg-field rg-ink"
      >
        {props.children}
      </section>
    );
  };
}
