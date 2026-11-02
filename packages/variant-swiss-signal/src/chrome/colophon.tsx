import { VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { present } from '../model';
import { uiLang, Words } from '../parts';

// The colophon (brief §5.1, component 18): four cells on the 3 px rule,
// the name, where to write, the visitor's appearance control, and this
// page's own actions: back to the top, and Print as a résumé, which the
// position enhancement shows once it can run.

export function Colophon({ input }: { input: VariantRenderInput }) {
  const { identity, locale } = input.portfolio;
  const lang = uiLang(locale);
  const email = present(identity.email) ? identity.email.trim() : undefined;
  return (
    <footer className="ss-colophon">
      <div className="ss-grid">
        <p className="ss-colophon__cell" data-type-role="body-compact">
          <b>{identity.name}</b>
          {present(identity.tagline) || present(identity.pronouns) ? (
            <span>
              {identity.tagline}
              {present(identity.pronouns) ? ` (${identity.pronouns})` : null}
            </span>
          ) : null}
        </p>
        {present(identity.location) || email ? (
          <p className="ss-colophon__cell" data-type-role="body-compact">
            {present(identity.location) ? <b>{identity.location}</b> : null}
            {email ? <a href={`mailto:${email}`}>{email}</a> : null}
          </p>
        ) : null}
        <div className="ss-colophon__cell ss-colophon__control" data-type-role="body-compact">
          <VisitorControlSlot />
        </div>
        <p className="ss-colophon__cell ss-colophon__page" data-type-role="body-compact">
          <b>
            <Words lang={lang}>This page</Words>
          </b>
          <a className="ss-top" href={`#${input.ids.main}`}>
            <Words lang={lang}>Back to the top</Words>
          </a>
          <button type="button" className="ss-print" data-ss-print="" hidden>
            <Words lang={lang}>Print as a résumé</Words>
          </button>
        </p>
      </div>
    </footer>
  );
}
