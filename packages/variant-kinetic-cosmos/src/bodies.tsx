import type { CSSProperties, ReactNode } from 'react';

// Kinetic Cosmos's two ways of showing a set of facts as bodies (redesign,
// stream E), so nothing below the stage falls back to ruled rows:
//
// - ArcBodies: moons on a front arc, each hung on a leader above its plate,
//   as under the signature work's cover and for a set of repositories.
// - Planets: figures as bodies, the number on the body and what it counts
//   on a plate beside it, joined by a short leader. They stay a `dl`.
//
// The arc, the bodies, and the leaders are decoration, hidden from
// assistive technology; every fact is in the plates.

export interface ArcBody {
  readonly key: string;
  readonly plate: ReactNode;
  readonly id?: string;
  readonly lang?: string;
}

/** Bodies on a front arc, each at its column's middle, the arc dipping 4t(1 - t) of its height there. */
export function ArcBodies({
  items,
  className,
}: {
  readonly items: readonly ArcBody[];
  readonly className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={className ? `kc-moons ${className}` : 'kc-moons'}>
      <svg
        className="kc-moons__arc"
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M0 0 Q50 20 100 0" />
      </svg>
      <ul className="kc-moons__list" role="list">
        {items.map((item, index) => {
          const at = (2 * index + 1) / (2 * items.length);
          return (
            <li
              key={item.key}
              id={item.id}
              lang={item.lang}
              className="kc-moon"
              style={{ '--layout-dip': (4 * at * (1 - at)).toFixed(3) } as CSSProperties}
            >
              <span className="kc-moon__body" aria-hidden="true" />
              <div className="kc-moon__plate">{item.plate}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface Planet {
  readonly key: string;
  /** The figure on the body: the number, formatted. */
  readonly value: ReactNode;
  /** Its unit, set small on the body after the number. */
  readonly unit?: ReactNode;
  /** What it counts, and where it comes from. */
  readonly plate: ReactNode;
  readonly id?: string;
  readonly lang?: string;
  readonly type?: string;
  /** The figure as a number, when it is one: a body's size follows it. */
  readonly magnitude?: number;
}

/**
 * Each body's size, as a share of the largest: log-scaled from 0.55 to 1, so
 * 3 and 3,481 read as different bodies without the small one vanishing. A
 * figure that isn't a number takes the middle size.
 */
function sizes(items: readonly Planet[]): number[] {
  const largest = Math.max(1, ...items.map((item) => Math.abs(item.magnitude ?? 0)));
  return items.map((item) =>
    item.magnitude === undefined
      ? 0.78
      : 0.55 + (0.45 * Math.log1p(Math.abs(item.magnitude))) / Math.log1p(largest),
  );
}

/** Figures as bodies with their plates: a description list, each pair a body and its plate. */
export function Planets({
  items,
  className,
}: {
  readonly items: readonly Planet[];
  readonly className?: string;
}) {
  if (items.length === 0) return null;
  const size = sizes(items);
  return (
    <dl className={className ? `kc-planets ${className}` : 'kc-planets'}>
      {items.map((item, index) => (
        <div
          key={item.key}
          id={item.id}
          lang={item.lang}
          className="kc-planet"
          data-evidence-type={item.type}
          style={{ '--layout-size': size[index]!.toFixed(3) } as CSSProperties}
        >
          <dt className="kc-planet__plate">{item.plate}</dt>
          <dd className="kc-planet__body">
            <span className="kc-planet__value">{item.value}</span>
            {item.unit ? <span className="kc-planet__unit">{item.unit}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
