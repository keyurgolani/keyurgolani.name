import type { ReactNode } from 'react';
import {
  footerOutline,
  Heading,
  present,
  renderSection,
  sameTarget,
  type FooterLink,
  type FooterOutline,
  type SectionComposition,
  type SectionFrameProps,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { headId } from '../frame';
import { homeward, said } from '../model';
import { Breakable, Out } from '../parts';

// The close: the second field, whose arc rises, and the page's one closing
// form (docs/variants.md). The contact section's frame holds it all; the
// call to action beside it renders inside, framed, under the one heading.
// In order: the heading, the message, the address at display size (the
// biggest link on the page's last screen), the call to action's actions,
// then every other way to get in touch, each place once, as
// footerOutline() lists them. Every action on the field reads on it
// (TF-M1): the primary is a paper pill with the primary text role, the
// rest the field's own ink.

/** Every other way to get in touch, less what the close already reaches. */
function ways(footer: FooterOutline, input: VariantRenderInput): readonly FooterLink[] {
  const listed = input.portfolio.contact?.links?.length
    ? (footer.contact?.links ?? [])
    : footer.links;
  return listed.filter(
    (link) =>
      !(footer.cta?.primary && sameTarget(link.href, footer.cta.primary.href)) &&
      !(footer.cta?.secondary && sameTarget(link.href, footer.cta.secondary.href)) &&
      !(footer.email && sameTarget(link.href, footer.email.href)),
  );
}

/** The ask: the message, the address, the actions. */
function Ask({
  footer,
  message,
  input,
}: {
  footer: FooterOutline;
  message: readonly string[];
  input: VariantRenderInput;
}) {
  const address = footer.email ?? footer.cta?.primary;
  const primary =
    footer.cta?.primary && !(address && sameTarget(footer.cta.primary.href, address.href))
      ? footer.cta.primary
      : undefined;
  const secondary = footer.cta?.secondary;
  return (
    <>
      {message.length > 0 ? (
        <div className="tf-close__msg">
          {message.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </div>
      ) : null}
      {address ? (
        <p className="tf-close__mail">
          <a className="tf-display-link" href={address.href}>
            <Breakable text={address.text} />
          </a>
        </p>
      ) : null}
      {primary || secondary ? (
        <p className="tf-close__acts">
          {primary ? (
            <a className="tf-act tf-act--canvas" href={homeward(primary.href, input)}>
              {primary.text}
            </a>
          ) : null}
          {secondary ? <Out href={homeward(secondary.href, input)}>{secondary.text}</Out> : null}
        </p>
      ) : null}
    </>
  );
}

/** The ways out of the close, inline. */
function Ways({ input, footer }: { input: VariantRenderInput; footer: FooterOutline }) {
  const links = ways(footer, input);
  if (links.length === 0) return null;
  return (
    <ul className="tf-close__ways tf-compact" role="list">
      {links.map((link) => (
        <li key={link.href}>
          <Out href={homeward(link.href, input)}>
            <Breakable text={link.text} />
          </Out>
        </li>
      ))}
    </ul>
  );
}

/** The call to action merged under the contact's heading: its own frame, holding the ask. */
function mergedCta(
  input: VariantRenderInput,
  footer: FooterOutline,
  takesTitle: boolean,
): SectionComposition {
  const contactMessage = input.portfolio.contact?.message;
  return {
    renderers: {
      cta: ({ section }) => (
        <Ask
          input={input}
          footer={footer}
          message={[
            takesTitle ? section.title : undefined,
            section.description,
            contactMessage,
          ].filter(present)}
        />
      ),
      contact: () => null,
    },
    Frame: ({ frame, children }: SectionFrameProps) => (
      <section {...frame} className="tf-close__ask">
        {children}
      </section>
    ),
  };
}

/** The heading id the close names its section by. */
const headIdOf = (input: VariantRenderInput, id: string) => `${input.ids.prefix}${id}--head`;

/** The close's head: its heading, centred on the axis. */
function Head({
  input,
  id,
  level,
  title,
  subtitle,
}: {
  input: VariantRenderInput;
  id: string;
  level: SectionFrameProps['level'];
  title?: string;
  subtitle?: string;
}): ReactNode {
  if (!said(title)) return null;
  return (
    <div className="tf-close__head">
      <Heading level={level} className="tf-headline">
        <span id={headIdOf(input, id)}>{title}</span>
      </Heading>
      {said(subtitle) ? <p className="tf-caption">{subtitle}</p> : null}
    </div>
  );
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
  const ask = cta ? (
    renderSection(cta, input, mergedCta(input, footer, ownTitle), {
      level: level < 6 ? ((level + 1) as SectionFrameProps['level']) : level,
    })
  ) : (
    <Ask
      footer={footer}
      message={[input.portfolio.contact?.message].filter(present)}
      input={input}
    />
  );
  return (
    <div className="tf-page">
      <div className="tf-close__inner">
        <Head
          input={input}
          id={section.id}
          level={level}
          title={heading}
          subtitle={section.subtitle}
        />
        {ask}
        <Ways input={input} footer={footer} />
      </div>
    </div>
  );
}

/** A call to action with no contact section beside it: the close alone, its title the heading. */
export function CtaBody({ section, input, level }: SectionRendererProps<SectionOf<'cta'>>) {
  const footer = footerOutline(input);
  return (
    <div className="tf-page">
      <div className="tf-close__inner">
        <Head input={input} id={section.id} level={level} title={section.title} />
        <Ask footer={footer} message={[section.description].filter(present)} input={input} />
        <Ways input={input} footer={footer} />
      </div>
    </div>
  );
}

/** The heading the close shows: the contact's title, else the call to action's. */
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

/** The close's frame: the rising field, named by its one heading, on accent unless quiet. */
export function closeFrame(input: VariantRenderInput, quiet: boolean) {
  return function CloseFrame(props: SectionFrameProps) {
    return (
      <section
        {...props.frame}
        {...(headingOf(props.section, input) !== undefined && headId(props.frame) !== undefined
          ? { 'aria-labelledby': headId(props.frame) }
          : {})}
        className="tf-close"
        data-ui-surface={quiet ? undefined : 'accent'}
      >
        {props.children}
      </section>
    );
  };
}
