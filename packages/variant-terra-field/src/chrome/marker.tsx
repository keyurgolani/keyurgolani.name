import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, type HomeModel } from '../model';
import { NotesButton } from './notes-button';

// The position marker (N2): a small horizon gauge that sticks on the
// page's axis below the opening. Its dot rides the arc as the page
// scrolls (a scroll-driven animation, CSS only, the visitor's own input);
// the destination in view is written beside it by the field enhancement,
// a sighted aid hidden from assistive technology, which hears the
// masthead's aria-current instead. It holds the one other way into Field
// notes. It names no field until the reader reaches one, so the opening
// never reads as Work; without a script it names none.

export function Marker({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const ids = chromeIds(input.ids.prefix);
  const first = model.fields[0];
  if (!first) return null;
  return (
    <div className="tf-marker">
      <div className="tf-marker__chip">
        <svg className="tf-gauge" viewBox="0 0 48 16" aria-hidden="true" focusable="false">
          <path className="tf-gauge__arc" d="M2 13 Q 24 -5 46 13" />
          <circle className="tf-gauge__dot" cx="2" cy="13" r="3" />
        </svg>
        <span className="tf-marker__where tf-label" id={ids.where} aria-hidden="true" />
        <span className="tf-marker__rule" aria-hidden="true" />
        <NotesButton
          notesId={ids.notes}
          uiLang={model.uiLang}
          glyph={false}
          className="tf-linkbtn tf-label"
        />
      </div>
    </div>
  );
}
