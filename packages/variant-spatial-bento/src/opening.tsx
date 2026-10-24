import {
  SHARED_RENDERERS,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';

// The opening tile (#16): the hero as the shared renderer writes it, every
// word the owner's and in reading order, beside a still of the spatial
// stage. The still is a CSS composition of a few tiles floating in depth,
// drawn by the server, decoration only: hidden from assistive technology,
// with no text, link, or control in it, so nothing it shows is anywhere but
// in the words beside it. It's the whole stage in this build, the static
// document mode; the stage that enhances it on capable devices follows in
// #16's second pull request, and this still stays as its fallback.

/** The still's tiles, back to front. */
const PLANES = ['far', 'middle', 'near', 'signature'] as const;

export function BentoOpening(props: SectionRendererProps<SectionOf<'hero'>>) {
  const Hero = SHARED_RENDERERS.hero;
  return (
    <div className="sb-opening">
      <div className="sb-opening__content">
        <Hero {...props} />
      </div>
      <div className="sb-still" aria-hidden="true">
        {PLANES.map((plane) => (
          <span key={plane} className={`sb-still__plane sb-still__plane--${plane}`} />
        ))}
      </div>
    </div>
  );
}
