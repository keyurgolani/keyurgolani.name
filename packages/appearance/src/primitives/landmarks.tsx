'use client';

// The landmark primitives (#19, Slice 3, item 2), which replace raw
// landmarks in variants: Main, Header, Footer, Aside, Region, and
// Navigation. In a document boundary each renders its native element; in a
// plate, a plain div with no role and no name, so a preview inside a page
// adds no landmark to it and the page keeps its one main. They're client
// components only to read which boundary they're in: whatever a server
// component passes as children still renders on the server.
//
// A landmark with pinned chrome, fixed or sticky, says so with `pinned`,
// and the controls inside it get the larger touch targets.

import type { ReactNode } from 'react';
import { useBoundary } from '../react/boundary-root';

interface LandmarkProps {
  readonly children?: ReactNode;
  readonly id?: string;
  /** A hook for the variant's layout. Never for state or appearance. */
  readonly className?: string;
  /** Its accessible name, when there's more than one of its kind, or always for a Region. */
  readonly label?: string;
  /** The id of the heading that names it, in place of `label`. */
  readonly labelledBy?: string;
  /** Fixed or sticky chrome: its controls get the 44 by 44 pixel touch target. */
  readonly pinned?: boolean;
  readonly lang?: string;
}

type LandmarkTag = 'main' | 'header' | 'footer' | 'aside' | 'section' | 'nav';

function Landmark({
  tag: Tag,
  children,
  id,
  className,
  label,
  labelledBy,
  pinned,
  lang,
  slot,
  orientation,
}: LandmarkProps & {
  readonly tag: LandmarkTag;
  readonly slot?: 'navigation';
  readonly orientation?: 'horizontal' | 'vertical';
}) {
  const { plate } = useBoundary();
  const shared = {
    id,
    className,
    lang,
    'data-ui-slot': slot,
    'data-orientation': orientation,
    'data-pinned': pinned ? '' : undefined,
  };
  if (plate) return <div {...shared}>{children}</div>;
  return (
    <Tag {...shared} aria-label={label} aria-labelledby={labelledBy}>
      {children}
    </Tag>
  );
}

export interface MainProps extends Omit<LandmarkProps, 'id' | 'pinned'> {
  /** The render input's ids.main, which the document boundary's skip link targets. */
  readonly id: string;
}

/** The variant's one main. */
export function Main(props: MainProps) {
  return <Landmark tag="main" {...props} />;
}

/** The page's banner, at the top of the variant. */
export function Header(props: LandmarkProps) {
  return <Landmark tag="header" {...props} />;
}

/** The page's content information, at its end. */
export function Footer(props: LandmarkProps) {
  return <Landmark tag="footer" {...props} />;
}

/** Content that complements the main content. */
export function Aside(props: LandmarkProps) {
  return <Landmark tag="aside" {...props} />;
}

export type RegionProps = LandmarkProps &
  ({ readonly label: string } | { readonly labelledBy: string });

/** A named region: a section a visitor may want to reach directly. It needs a name. */
export function Region(props: RegionProps) {
  if (!props.label && !props.labelledBy) {
    throw new TypeError('A Region needs a name: give it a label or the id of its heading.');
  }
  return <Landmark tag="section" {...props} />;
}

/** One link in a Navigation. */
export interface NavigationItem {
  readonly href: string;
  readonly label: ReactNode;
  /** The link to where the visitor is: `page`, or `location` within a page. */
  readonly current?: 'page' | 'location' | 'step';
  readonly lang?: string;
}

export interface NavigationProps extends Omit<LandmarkProps, 'children' | 'labelledBy'> {
  /** Its accessible name, such as Primary. */
  readonly label: string;
  readonly items: readonly NavigationItem[];
  readonly orientation?: 'horizontal' | 'vertical';
}

/** A named list of links, the current one marked with aria-current. */
export function Navigation({ items, orientation = 'horizontal', ...props }: NavigationProps) {
  return (
    <Landmark tag="nav" slot="navigation" orientation={orientation} {...props}>
      <ul data-ui-slot="navigation.list">
        {items.map((item, index) => (
          <li key={`${item.href}#${index}`} data-ui-slot="navigation.item">
            <a
              data-ui-slot="navigation.link"
              href={item.href}
              aria-current={item.current}
              lang={item.lang}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </Landmark>
  );
}
