import {
  SHARED_RENDERERS,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { StageSlot } from './stage';

// The opening tile (#16): the hero as the shared renderer writes it, every
// word the owner's and in reading order, beside the spatial stage's slot.
// The server draws the stage's still, a CSS composition of a few tiles
// floating in depth: decoration only, hidden from assistive technology,
// with no text, link, or control in it. On a device the stage's policy lets
// run it, the spatial stage draws over the still, with an exit beside it;
// anywhere else, and whenever it stops or fails, the still is the stage.

export function BentoOpening(props: SectionRendererProps<SectionOf<'hero'>>) {
  const Hero = SHARED_RENDERERS.hero;
  return (
    <div className="sb-opening">
      <div className="sb-opening__content">
        <Hero {...props} />
      </div>
      <StageSlot seed={props.input.env.seed} idPrefix={props.input.ids.prefix} />
    </div>
  );
}
