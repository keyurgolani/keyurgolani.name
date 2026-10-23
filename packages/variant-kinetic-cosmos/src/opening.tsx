import {
  SHARED_RENDERERS,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';

// The orbital opening (#14), still: the hero as the shared renderer writes
// it, every word the owner's and in reading order, set in front of a still
// orbit. The orbit is decoration, hidden from assistive technology: three
// rings and a core, and the core carries the composition's one signature,
// the design language's signature fill. Nothing in it is hidden in the
// server's markup, and nothing moves: the motion layer, which follows,
// starts from this still frame.

const RINGS = ['inner', 'middle', 'outer'] as const;

export function OrbitalOpening(props: SectionRendererProps<SectionOf<'hero'>>) {
  const Hero = SHARED_RENDERERS.hero;
  return (
    <div className="kc-opening">
      <div className="kc-orbit" aria-hidden="true">
        {RINGS.map((ring) => (
          <span key={ring} className={`kc-orbit__ring kc-orbit__ring--${ring}`} />
        ))}
        <span className="kc-orbit__core" />
      </div>
      <div className="kc-opening__content">
        <Hero {...props} />
      </div>
    </div>
  );
}
