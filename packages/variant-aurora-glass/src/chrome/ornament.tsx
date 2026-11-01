import { VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { ownId, uiLang, Words } from '../parts';

// The ornament (brief §5.2, step 4; AG-S2; M2): one group on the page's end
// column line, beside the capsule: "Pause the sky", which stops both loops
// (the curtains and the bead's breath), and the visitor's appearance
// control. Pause ships hidden: the sky only moves once the enhancement has
// started it, and the enhancement shows Pause then, so it never offers to
// stop motion that isn't there (no script, reduced motion, a static page,
// touch and narrow screens, or the owner's drift off with no Lens).
//
// Below 75rem there's no room for the ornament beside a centred capsule,
// so Pause is the capsule's last item instead (the design review, G1/S2).
// It's one button in two places, one displayed per width (styles.css): the
// enhancement keeps both in step, and the one not displayed has no box and
// no place in the accessibility tree.

export function PauseButton({
  input,
  place,
}: {
  input: VariantRenderInput;
  place: 'ornament' | 'capsule';
}) {
  const lang = uiLang(input.portfolio.locale);
  const held = ownId(input.ids.prefix, place === 'capsule' ? 'pause-capsule-held' : 'pause-held');
  return (
    <>
      <button
        type="button"
        className={place === 'capsule' ? 'ag-orn ag-orn--capsule' : 'ag-orn'}
        id={ownId(input.ids.prefix, place === 'capsule' ? 'pause-capsule' : 'pause')}
        aria-pressed="false"
        aria-describedby={held}
        data-ag-pause=""
        hidden
      >
        <span className="ag-orn__mark" aria-hidden="true" />
        <span className="ag-orn__word">
          <Words lang={lang}>Pause the sky</Words>
        </span>
      </button>
      {/* Still, it says why right after itself (sky.ts fills it): plain text on the page, and its
          description, outside its name, so its name stays its word in either state. Live, hidden. */}
      <span className="ag-orn__held" id={held} data-ag-held="" hidden />
    </>
  );
}

export function Ornament({ input }: { input: VariantRenderInput }) {
  return (
    <div className="ag-ornament">
      <PauseButton input={input} place="ornament" />
      <VisitorControlSlot />
    </div>
  );
}
