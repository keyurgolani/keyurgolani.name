import { MotionControl } from '@portfolio/kit/runtime';
import type { MotionPolicy } from '@portfolio/schema';
import type { TickerFact } from '../model';

// The proof ticker: the facts across the top, at full bleed on the
// prominent ground. The track is decoration over facts the page shows as
// text (At a glance, the awards), so it's hidden from assistive technology
// whole, its second copy included. With no script, in a plate, under
// reduced motion, on a still language, where the window is narrow or
// short or the text enlarged (so nothing is clipped), and under high
// contrast, in its display mode, more contrast or forced colors (so its
// text keeps its contrast in every frame), it's one static pass that wraps. The client module runs it (data-ticker="running") on the
// kit's runtime, which pauses it off screen, in a hidden tab, and when the
// visitor pauses motion; it pauses on hover too. Its end cell is the kit's
// MotionControl (WCAG 2.2.2): pausing stops every effect on the page, this
// belt the one that runs here; under reduced motion it stays, disabled,
// and says so; under the site's reduce policy it renders nothing.

export function Ticker({
  facts,
  uiLang,
  policy,
}: {
  facts: readonly TickerFact[];
  uiLang: 'en' | undefined;
  /** The site's motion policy, input.presentation.motionPolicy. */
  policy: MotionPolicy;
}) {
  if (facts.length === 0) return null;
  const run = (copy: boolean) => (
    <ul className="rg-ticker__run" role="list" data-copy={copy ? '' : undefined}>
      {facts.map((fact) => (
        <li key={fact.id} lang={fact.lang}>
          {fact.text}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="rg-ticker" data-ticker="static">
      <div className="rg-ticker__track" aria-hidden="true">
        <div className="rg-ticker__belt">
          {run(false)}
          {run(true)}
        </div>
      </div>
      {policy === 'reduce' ? null : (
        <span className="rg-ticker__toggle" lang={uiLang}>
          <MotionControl className="rg-ticker__control" policy={policy} />
        </span>
      )}
    </div>
  );
}
