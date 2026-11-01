import { VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, hasNotes, type HomeModel } from '../model';
import { Words } from '../parts';
import { destinationHref } from './masthead';
import { NotesButton } from './notes-button';

// The footer (footerOutline): it continues the closing field's ground
// under a hairline in the field's own ink. The name and the portfolio's own
// description; the five destinations once more, for a page read with no
// script, where Field notes may not open; the visitor's control (the
// manifest's footer placement); Field notes; and the way back to the top.

export function Footer({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const ids = chromeIds(input.ids.prefix);
  const { footer, navigation, uiLang } = model;
  const note = footer.colophon.description ?? footer.tagline;
  return (
    <footer className="tf-foot" data-ui-surface={model.quiet ? undefined : 'accent'}>
      <div className="tf-page">
        <div className="tf-foot__row">
          <div className="tf-foot__who">
            <p className="tf-title">{footer.name}</p>
            {note ? <p className="tf-compact">{note}</p> : null}
          </div>
          {navigation.primary.length > 0 ? (
            <nav className="tf-foot__nav" aria-label="Destinations">
              <ul className="tf-compact" role="list">
                {navigation.primary.map((destination) => (
                  <li key={destination.id}>
                    <a
                      href={destinationHref(destination.id, destination.href, input, model)}
                      lang={destination.lang}
                    >
                      {destination.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className="tf-foot__end tf-compact">
            <VisitorControlSlot />
            {hasNotes(model) ? (
              <NotesButton notesId={ids.notes} uiLang={uiLang} glyph={false} />
            ) : null}
            <a href={`#${input.ids.main}`}>
              <Words lang={uiLang}>Back to the top</Words>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
