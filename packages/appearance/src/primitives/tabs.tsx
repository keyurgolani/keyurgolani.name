'use client';

// Tabs (#19, Slice 3, item 2). Without JavaScript, on the server, and in a
// plate, every panel is a headed section, so all of it reads in order and
// a fragment link reaches it. Once it hydrates in a document boundary it
// becomes a tablist with roving focus: one tab in the tab order, the arrow
// keys move between tabs and select them, Home and End go to the ends, and
// the selected panel follows. It takes a local id and adds the boundary's
// prefix.

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useBoundary, useBoundaryId, useHydrated } from '../react/boundary-root';
import { partId } from '../ids';

export interface TabItem {
  /** The tab's own name, lowercase words, which its ids end with. */
  readonly id: string;
  readonly label: ReactNode;
  readonly content: ReactNode;
}

export interface TabsProps {
  /** A local id, which the boundary's prefix starts. */
  readonly id: string;
  /** The tablist's accessible name, such as Evidence views. */
  readonly label: string;
  readonly items: readonly TabItem[];
  /** The tab selected at first: the first unless this names another. */
  readonly defaultSelected?: string;
  /** The sections' heading level without JavaScript. */
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly className?: string;
}

/** What both forms render from: the prefixed id and the props. */
type Resolved = Omit<TabsProps, 'id'> & { readonly id: string };

export function Tabs({ id: local, ...props }: TabsProps) {
  const id = useBoundaryId(local);
  const { plate } = useBoundary();
  // The server and the hydrating render agree on the sections; the tablist
  // replaces them once the browser has hydrated, outside a plate.
  const interactive = useHydrated() && !plate;
  return interactive ? <TabList {...props} id={id} /> : <TabSections {...props} id={id} />;
}

const panelId = (id: string, item: TabItem) => partId(id, `panel-${item.id}`);
const tabId = (id: string, item: TabItem) => partId(id, `tab-${item.id}`);

/** The form without JavaScript: a headed section per tab. */
export function TabSections({
  id,
  items,
  headingLevel = 3,
  orientation = 'horizontal',
  className,
}: Resolved) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div id={id} className={className} data-ui-slot="tabs" data-orientation={orientation}>
      {items.map((item) => {
        const headingId = partId(id, `heading-${item.id}`);
        return (
          <section
            key={item.id}
            id={panelId(id, item)}
            data-ui-slot="tabs.panel"
            aria-labelledby={headingId}
          >
            <Heading data-ui-slot="tabs.heading" id={headingId}>
              {item.label}
            </Heading>
            {item.content}
          </section>
        );
      })}
    </div>
  );
}

/** The interactive form: a tablist with roving focus, and its panels. */
export function TabList({
  id,
  label,
  items,
  defaultSelected,
  orientation = 'horizontal',
  className,
}: Resolved) {
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      items.findIndex((item) => item.id === defaultSelected),
    ),
  );
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (index: number) => {
    const count = items.length;
    const next = ((index % count) + count) % count;
    setSelected(next);
    tabs.current[next]?.focus();
  };
  const step: Readonly<Record<string, number>> =
    orientation === 'horizontal' ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key in step
        ? index + step[event.key]!
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : null;
    if (next === null) return;
    event.preventDefault();
    select(next);
  };

  return (
    <div id={id} className={className} data-ui-slot="tabs" data-orientation={orientation}>
      <div
        role="tablist"
        data-ui-slot="tabs.list"
        aria-label={label}
        aria-orientation={orientation}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={tabId(id, item)}
            data-ui-slot="tabs.tab"
            aria-selected={index === selected}
            aria-controls={panelId(id, item)}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          key={item.id}
          role="tabpanel"
          id={panelId(id, item)}
          data-ui-slot="tabs.panel"
          aria-labelledby={tabId(id, item)}
          tabIndex={0}
          hidden={index !== selected}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
