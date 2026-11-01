import { hrefFor, type SectionOf, type SectionRendererProps } from '@portfolio/kit/sections';
import { contactLinksOf, linkText, planOf, present, squash } from '../model';
import { Hidden, Phrase, uiLang } from '../parts';
import { headingId, PanelLabel } from './panel';

// Panel 6, Contact (brief §5.7): the one panel drenched in the accent, its
// title at the hero step, the owner's note on how to write, the calls to
// action it nests beside it, and every other way in as a row of links. Its
// action band is the largest target on the page: Email and the name, on
// ink, full width.

export function ContactRenderer({ section, input }: SectionRendererProps<SectionOf<'contact'>>) {
  const panel = planOf(input).panelOf.get(section.id);
  const message = input.portfolio.contact?.message;
  const links = contactLinksOf(input);
  const lang = uiLang(input.portfolio.locale);
  return (
    <>
      {panel ? (
        <h2
          className="sg-contact__h"
          id={headingId(input, panel)}
          tabIndex={-1}
          data-sg-heading=""
          data-type-role="display"
          data-sg-rise="lead"
        >
          <PanelLabel input={input} panel={panel} />
        </h2>
      ) : null}
      {present(section.subtitle) ? (
        <p className="sg-panel__sub sg-contact__sub" data-type-role="body" data-sg-rise="meta">
          <Phrase source={section.subtitle} input={input} />
        </p>
      ) : null}
      {present(message) ? (
        <p className="sg-contact__msg" data-type-role="headline" data-sg-rise="support">
          {squash(message)}
        </p>
      ) : null}
      {links.length > 0 ? (
        <ul className="sg-contact__links" role="list" data-type-role="title" data-sg-rise="meta">
          {links.map((link) => (
            <li key={link.url}>
              <a
                href={hrefFor(link.url.trim(), input)}
                data-out={/^https?:/i.test(link.url) ? '' : undefined}
              >
                {linkText(link)}
                {/^https?:/i.test(link.url) ? (
                  <Hidden lang={lang}>(opens another site)</Hidden>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
