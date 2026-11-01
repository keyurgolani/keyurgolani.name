import type { CSSProperties } from 'react';
import type { CaseStudyPart } from '@portfolio/kit/sections';

// A case study's flight (redesign, stream E): its stops in order, as links
// riding an orbit arc, the way each ring's chapter opens on its own. It's a
// nav of real links, so it works with no script; the dock says which stop
// you're at.

/** Each part of a case study in the composition's own words: none of them is a template's heading. */
export const STOP_WORDS: Readonly<Record<CaseStudyPart['key'], string>> = {
  challenge: 'Why it had to exist',
  context: 'The system around it',
  role: 'My part in it',
  constraints: 'What it couldn’t move',
  decisions: 'The course it took',
  evidence: 'What the readings said',
  outcomes: 'Where it landed',
  reflection: 'Looking back from here',
};

/** The parts of a case that read as its setting: rows of the fact sheet, not bodies of their own. */
export const FACT_PARTS: ReadonlySet<CaseStudyPart['key']> = new Set([
  'challenge',
  'context',
  'role',
  'constraints',
]);

/**
 * The case's stops as links riding an orbit arc, as each ring's chapter
 * opens on one (KC-M2: stops on an orbit, not a stepper), in two tiers when
 * there are more than five.
 */
export function FlightArc({
  parts,
  uiLang,
}: {
  readonly parts: readonly CaseStudyPart[];
  readonly uiLang?: string;
}) {
  if (parts.length === 0) return null;
  const tiers = parts.length > 5;
  return (
    <div className="kc-arc kc-flight" data-ring="1" data-tiers={tiers ? '' : undefined}>
      <svg
        className="kc-arc__line"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M0 100 Q500 -100 1000 100" />
      </svg>
      <span className="kc-arc__trail" aria-hidden="true" />
      <span className="kc-arc__body" aria-hidden="true" />
      <nav
        className="kc-arc__index"
        aria-label={`The case, in ${parts.length === 1 ? 'one stop' : `${parts.length} stops`}`}
        lang={uiLang}
      >
        <ol role="list">
          {parts.map((part, index) => {
            const at = parts.length === 1 ? 0.5 : 0.22 + (0.7 * index) / (parts.length - 1);
            const rise = 1 - Math.pow((at - 0.5) / 0.5, 2);
            return (
              <li
                key={part.key}
                className="kc-arc__stop"
                data-tier={tiers ? index % 2 : undefined}
                style={
                  {
                    '--layout-at': at.toFixed(3),
                    '--layout-rise': rise.toFixed(3),
                  } as CSSProperties
                }
              >
                <a href={part.href}>{STOP_WORDS[part.key]}</a>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
