import type { VariantRenderInput } from '@portfolio/variant-contract';
import { homeStopsOf, type Stop } from '../model';

// The phone's strip (brief §5.7, step 3; SG-S5): under the bar, one
// segment per panel, so it counts what the bands' "n / N" counts, filled up
// to the one being read and full in the record. It's decoration: the rail it stands in for, and Contents, are the
// ways to move, so it's hidden from assistive technology and holds no link.

export function Strip({
  input,
  stops = homeStopsOf(input),
}: {
  input: VariantRenderInput;
  stops?: readonly Stop[];
}) {
  return (
    <div className="sg-strip" aria-hidden="true" data-ground="canvas">
      {stops
        .filter((stop) => stop.n !== undefined)
        .map((stop) => (
          <span key={stop.anchor} className="sg-strip__seg" data-sg-for={stop.anchor} />
        ))}
    </div>
  );
}
