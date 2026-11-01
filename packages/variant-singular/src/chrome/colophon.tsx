import { hrefFor, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { contactLinksOf, linkText, planOf, present, squash } from '../model';
import { uiLang, Words } from '../parts';

// The colophon (brief §5.7, step 3): one ruled row on the grid under the
// record, the name, the way back to the start, where to write, and the
// visitor's appearance control. With no contact panel to hold them, the
// owner's links sit here, so none is lost.

export function Colophon({ input }: { input: VariantRenderInput }) {
  const { identity, locale } = input.portfolio;
  const lang = uiLang(locale);
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const contactPanel = planOf(input).panels.some((panel) => panel.key === 'contact');
  const links = contactPanel ? [] : contactLinksOf(input);
  return (
    <footer className="sg-colophon" data-ground="canvas">
      <div className="sg-grid sg-colophon__in" data-type-role="body">
        <p className="sg-colophon__name">
          <b>{squash(identity.name)}</b>
        </p>
        <p className="sg-colophon__top">
          <a href={`#${input.ids.main}`}>
            <Words lang={lang}>Back to the start</Words>
          </a>
        </p>
        <div className="sg-colophon__where">
          {email ? <a href={`mailto:${email}`}>{email}</a> : null}
          {links.length > 0 ? (
            <ul className="sg-colophon__links" role="list">
              {links.map((link) => (
                <li key={link.url}>
                  <a href={hrefFor(link.url.trim(), input)}>{linkText(link)}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="sg-colophon__control">
          <VisitorControlSlot />
        </div>
      </div>
    </footer>
  );
}
