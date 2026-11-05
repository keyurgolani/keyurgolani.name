import { MediaBackdrop } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { enhancementPending } from '@portfolio/variant-contract/settle';
import { backdropOf, controlsOf, ownerSkyOf } from './model';
import { Img, readyImage } from './parts';

// The sky (brief §5.2, step 2; S9): one fixed, aria-hidden layer behind the
// page, built from the scheme's roles alone, so it turns clay and peach
// under the default recipe and night forest in dark. Under it all, a 160°
// base from the sequential ramp to the emphasis crest; over that, the
// owner's own landscape photograph when the backdrop control finds one,
// masked to the horizon; then three curtains in the signature colours and
// a horizon of two hills. Every layer paints opaque role colours; masks
// and gradients between opaque stops shape them, never a translucent fill
// (the glass ruling). No text ever sits on it: every word is on a pane or
// a sheet.
//
// The curtains drift as one layer, and only once the enhancement has
// started them (data-ag-sky on the root): with no script, under reduced
// motion and on a static page the sky is its still frame.
//
// The backdrop is one named layer (lead A's ruling for P1: opaque and owned
// by the composition). `Sky` is its single root, marked `data-ag-backdrop`,
// and every layer of it, the base, the photograph, the curtains and the
// hills, is inside that root and nowhere else. That attribute is the hook a
// later appearance or the host reads to find, replace or tint the backdrop
// as a whole; nothing else on the page carries it. The photograph is opaque
// too, shaped by its mask alone. The owner may choose it (K-8): the
// `backdropMedia` media ref, one decorative <img> from the kit's
// MediaBackdrop over WebP renditions up to 1600w; a stale ref renders as
// none, and then `backdrop` decides, as it always did.
//
// The root also carries the sky enhancement's settle signal
// (@portfolio/variant-contract/settle): `data-enhancement-pending="sky"`
// until the enhancement's first pass has marked the page live, started the
// loops and had each observer's first delivery (enhancements/sky.ts), or the
// kit has failed it. It styles nothing.

/** The backdrop layer's root: one per page, `[data-ag-backdrop]`, holding every layer of the sky. */
export function Sky({ input }: { input: VariantRenderInput }) {
  // The owner's own photograph by media ref (K-8), else the automatic pick, else roles alone.
  const owner = ownerSkyOf(input);
  const backdrop = backdropOf(input);
  const placed = backdrop ? readyImage(backdrop.placement, input) : undefined;
  return (
    <div
      className="ag-sky"
      aria-hidden="true"
      data-ag-backdrop=""
      data-ag-drift={controlsOf(input).drift ? 'on' : 'off'}
      {...enhancementPending('sky')}
    >
      <div className="ag-sky__base" />
      {owner ? (
        <MediaBackdrop backdrop={owner.backdrop} className="ag-sky__photo" />
      ) : placed ? (
        <Img placed={placed} input={input} className="ag-sky__photo" sizes="100vw" decorative />
      ) : null}
      {/* Over the photograph, the layer that dims it on a dark set (styles.css). */}
      {owner || placed ? <span className="ag-sky__dim" /> : null}
      <div className="ag-sky__curtains">
        <span className="ag-curtain ag-curtain--a" />
        <span className="ag-curtain ag-curtain--b" />
        <span className="ag-curtain ag-curtain--c" />
      </div>
      <svg
        className="ag-sky__hills"
        viewBox="0 0 1600 300"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path
          className="ag-sky__hill ag-sky__hill--far"
          d="M0 170C220 110 420 120 640 150S1060 210 1260 160 1500 120 1600 130V300H0Z"
        />
        <path
          className="ag-sky__hill ag-sky__hill--near"
          d="M0 240C260 190 520 200 760 228S1200 262 1420 222 1560 206 1600 212V300H0Z"
        />
      </svg>
    </div>
  );
}
