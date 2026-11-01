import type { ReactNode } from 'react';

// The record's one entry form (brief §5.7, the record's three tracks): the
// section's head in the first track, then each entry as its main text on
// the second and its facts on the third, all at one size. Hierarchy is
// weight and position only (T1 a, monoscale).

export function Entries({ children }: { children: ReactNode }) {
  return (
    <ul className="sg-entries" role="list">
      {children}
    </ul>
  );
}

export function Entry({
  title,
  href,
  level,
  lang,
  children,
  meta,
}: {
  title?: ReactNode;
  href?: string;
  /** The entry title's heading level, one below its section's. */
  level: 3 | 4 | 5 | 6;
  lang?: string;
  children?: ReactNode;
  meta?: ReactNode;
}) {
  const Heading = `h${level}` as 'h4';
  return (
    <li className="sg-entry" lang={lang}>
      <div className="sg-entry__main">
        {title !== undefined ? (
          <Heading className="sg-entry__title">{href ? <a href={href}>{title}</a> : title}</Heading>
        ) : null}
        {children}
      </div>
      {meta ? <p className="sg-entry__meta">{meta}</p> : null}
    </li>
  );
}

/** Facts on one line, each its own span, joined by commas (never a middle dot, C3). */
export function Facts({ parts }: { parts: readonly ReactNode[] }) {
  const shown = parts.filter(
    (part) => part !== null && part !== undefined && part !== false && part !== '',
  );
  return (
    <>
      {shown.map((part, i) => (
        <span key={i}>
          {i > 0 ? ', ' : null}
          {part}
        </span>
      ))}
    </>
  );
}
