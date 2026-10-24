import {
  SHARED_RENDERERS,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { OpeningStage } from './stage';

// The orbital opening (#14): the hero as the shared renderer writes it,
// every word the owner's and in reading order, set in front of an orbit of
// three rings around a core, which carries the composition's one signature,
// the design language's signature fill. The stage around it is the motion
// layer: on #6's runtime the orbit turns and a bounded glyph field falls
// behind it, and under reduced motion, a static environment, or in a plate,
// it's the still frame the server drew. The decoration is hidden from
// assistive technology, and nothing in the server's markup is hidden that
// the words need.

export function OrbitalOpening(props: SectionRendererProps<SectionOf<'hero'>>) {
  const Hero = SHARED_RENDERERS.hero;
  return (
    <OpeningStage>
      <Hero {...props} />
    </OpeningStage>
  );
}
