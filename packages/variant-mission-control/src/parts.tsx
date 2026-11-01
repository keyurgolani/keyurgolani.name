import type { ReactNode } from 'react';
import type { Link } from '@portfolio/schema';
import { present } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { BoardId, Count, HomeModel, Lamp } from './model';
import { countWords } from './model';

// The small pieces every Mission Control panel is built from: the
// composition's own words (marked English in a portfolio in another
// language), a lamp (a dot and a word, always), a title bar's count, an
// outbound link's mark, and the board icons.

/** Text only assistive technology reads. */
export function Sr({ children, lang }: { children: ReactNode; lang?: string }) {
  return (
    <span className="mc-sr" lang={lang}>
      {children}
    </span>
  );
}

/** The composition's own words, in English, marked so where the content isn't. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Whether a link leaves the site: anything with a scheme but mail. */
export const outbound = (href: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('mailto:');

/** A link, with the outbound mark joined to its last word when it leaves the site. */
export function Out({
  href,
  children,
  className,
  lang,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  lang?: string;
}) {
  return (
    <a className={className} href={href} lang={lang}>
      {children}
      {outbound(href) ? (
        <span className="mc-out" aria-hidden="true">
          {'⁠↗'}
        </span>
      ) : null}
    </a>
  );
}

/** A lamp: its dot, then its word, which carries the state on its own. */
export function LampText({ lamp, uiLang }: { lamp: Lamp; uiLang: 'en' | undefined }) {
  return (
    <span className="mc-lamp" data-lamp={lamp.tone}>
      <Words lang={lamp.tone === 'information' ? undefined : uiLang}>{lamp.text}</Words>
    </span>
  );
}

/** A record's lamps in a row, or nothing when its fields give none. */
export function Lamps({ lamps, uiLang }: { lamps: readonly Lamp[]; uiLang: 'en' | undefined }) {
  if (lamps.length === 0) return null;
  return (
    <span className="mc-lamps">
      {lamps.map((lamp, index) => (
        <LampText key={index} lamp={lamp} uiLang={uiLang} />
      ))}
    </span>
  );
}

/** A title bar's count: the figure in the numeric role, then its word. */
export function CountText({ count, uiLang }: { count: Count; uiLang: 'en' | undefined }) {
  return (
    <span className="mc-count">
      <span className="mc-num">{count.n}</span> <Words lang={uiLang}>{countWords(count)}</Words>
    </span>
  );
}

const ICONS: Readonly<Record<BoardId, () => ReactNode>> = {
  overview: () => (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  work: () => (
    <>
      <path d="M12 4 3 8.5l9 4.5 9-4.5L12 4Z" />
      <path d="m3 12.5 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </>
  ),
  writing: () => (
    <>
      <path d="M5 6h14" />
      <path d="M5 10h14" />
      <path d="M5 14h10" />
      <path d="M5 18h7" />
    </>
  ),
  record: () => (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="m9 13.5-1.5 6.5 4.5-2.5 4.5 2.5-1.5-6.5" />
    </>
  ),
  about: () => (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5" />
    </>
  ),
  contact: () => (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 15.5a5 5 0 0 1 0-7" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M5.6 18.4a9 9 0 0 1 0-12.8" />
      <path d="M18.4 5.6a9 9 0 0 1 0 12.8" />
    </>
  ),
};

/** A board's icon: decoration beside the board's name, which says it in words. */
export function BoardIcon({ board }: { board: BoardId }) {
  return (
    <svg
      className="mc-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[board]()}
    </svg>
  );
}

/**
 * The marks correlate reads on a record (MC-M4): its key, and the keys of
 * the records it names, when it names any. With correlate off, or nothing
 * on the page naming anything, a record carries none.
 */
export function traceAttrs(
  id: string,
  model: Pick<HomeModel, 'relations'>,
): { 'data-mc-rec'?: string; 'data-mc-names'?: string } {
  if (model.relations.names.size === 0) return {};
  const names = model.relations.names.get(id);
  return { 'data-mc-rec': id, ...(names ? { 'data-mc-names': names.join(' ') } : {}) };
}

/**
 * A record's Linked control (MC-M4, MC-M5): a button that opens a native
 * popover listing the records it names, each a link to its place on the
 * page. It needs no script: the browser opens and closes the popover, in
 * the top layer, inside the window. The correlate enhancement reads an open
 * popover as the pin, so the records it lists light while it's open. Only
 * the record's own copy (the one that holds its anchor) carries one.
 */
export function Linked({
  id,
  model,
  input,
}: {
  id: string;
  model: Pick<HomeModel, 'relations' | 'uiLang'>;
  input: Pick<VariantRenderInput, 'ids'>;
}) {
  const names = model.relations.names.get(id);
  const self = model.relations.labels.get(id);
  if (!names || names.length === 0 || !self) return null;
  const pop = `${input.ids.prefix}mc--linked-${id}`;
  return (
    <div className="mc-linked">
      <button type="button" className="mc-linked__button" popoverTarget={pop} data-mc-pin={id}>
        <svg
          className="mc-icon mc-icon--small"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <path d="m8.3 10.8 7.4-3.6M8.3 13.2l7.4 3.6" />
        </svg>
        <span className="mc-num">{names.length}</span> <Words lang={model.uiLang}>linked</Words>
        <Sr lang={model.uiLang}>{names.length === 1 ? ' record' : ' records'}</Sr>
      </button>
      <div popover="auto" id={pop} className="mc-pop" data-mc-pop={id}>
        <p className="mc-pop__title">
          <Words lang={model.uiLang}>Linked to</Words> <span lang={self.lang}>{self.text}</span>
        </p>
        <ul className="mc-pop__list">
          {names.map((other) => {
            const label = model.relations.labels.get(other)!;
            return (
              <li key={other} lang={label.lang}>
                {label.href ? <a href={label.href}>{label.text}</a> : <span>{label.text}</span>}
                {label.kind ? (
                  <span className="mc-pop__kind">
                    {' '}
                    <Words lang={model.uiLang}>{label.kind}</Words>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * A record's state line: its lamps, then its Linked control on the record's
 * own copy (`anchored`), or nothing when it has neither.
 */
export function StateLine({
  id,
  lamps,
  anchored,
  model,
  input,
}: {
  id: string;
  lamps: readonly Lamp[];
  anchored: boolean;
  model: Pick<HomeModel, 'relations' | 'uiLang'>;
  input: Pick<VariantRenderInput, 'ids'>;
}) {
  const linked = anchored && (model.relations.names.get(id)?.length ?? 0) > 0;
  if (lamps.length === 0 && !linked) return null;
  return (
    <div className="mc-state">
      <Lamps lamps={lamps} uiLang={model.uiLang} />
      {linked ? <Linked id={id} model={model} input={input} /> : null}
    </div>
  );
}

/** A link record's words: its label, its platform, else its address. */
export const linkText = (link: Pick<Link, 'label' | 'platform' | 'url'>) =>
  [link.label, link.platform].find(present) ?? link.url.replace(/^[a-z]+:\/\//i, '');
