import { VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, countOf, said, type Board, type BoardId, type HomeModel } from './model';
import { BoardIcon, CountText, Out, Words } from './parts';

// The instrument's chrome: the 52 px board rail (the name's mark, then an
// icon per destination, its word shown on hover after a short wait and at
// once on keyboard focus; docked to the foot as an icon bar on a phone),
// the status line (the name, the board, and real readings only), each
// board's header band, and the colophon at the foot.

/** The name's mark: its initials, the first letter of its first two words. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '');
  return letters.join('').toLocaleUpperCase();
}

export function Rail({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const ids = chromeIds(input.ids.prefix);
  const { navigation, uiLang } = model;
  return (
    <nav id={ids.rail} className="mc-rail" aria-labelledby={ids.railTitle}>
      <span id={ids.railTitle} className="mc-sr" lang={uiLang}>
        Boards
      </span>
      <a className="mc-rail__mark" href={navigation.name.href}>
        <span aria-hidden="true">{monogram(navigation.name.label)}</span>
        <span className="mc-rail__label">{navigation.name.label}</span>
      </a>
      {navigation.primary.length > 0 ? (
        <ul className="mc-rail__list">
          {navigation.primary.map((destination) => (
            <li key={destination.id}>
              <a className="mc-rail__link" href={destination.href} lang={destination.lang}>
                <BoardIcon board={destination.id as BoardId} />
                <span className="mc-rail__label">{destination.label}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

export function StatusLine({
  input,
  model,
  crumb,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  /** On a work's own page: the board it's back to, after the name. */
  crumb?: { readonly href: string; readonly label: string; readonly lang?: string };
}) {
  const ids = chromeIds(input.ids.prefix);
  return (
    <header id={ids.status} className="mc-status">
      <p className="mc-status__where">
        <a href={model.navigation.name.href}>{model.navigation.name.label}</a>
        {crumb ? (
          <>
            <span className="mc-status__sep" aria-hidden="true">
              /
            </span>
            <a href={crumb.href} lang={crumb.lang}>
              {crumb.label}
            </a>
          </>
        ) : null}
      </p>
      {model.signals.length > 0 ? (
        <ul className="mc-status__signals">
          {model.signals.map((signal) => (
            <li key={signal.key}>
              <span className="mc-lamp" data-lamp={signal.lamp}>
                <Words lang={model.uiLang}>{signal.label}</Words>{' '}
                <time className="mc-num" dateTime={signal.date}>
                  {signal.text}
                </time>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mc-status__end">
        <VisitorControlSlot />
      </div>
    </header>
  );
}

/** A board's header band: its icon, its name, its derived counts, and its own index. */
export function BoardHead({
  board,
  input,
  model,
}: {
  board: Board;
  input: VariantRenderInput;
  model: HomeModel;
}) {
  const ids = chromeIds(input.ids.prefix);
  const records = board.entries.reduce((sum, entry) => sum + (countOf(entry)?.n ?? 0), 0);
  const titled = board.entries.filter(
    (entry) => entry.title !== undefined && entry.href !== undefined,
  );
  return (
    <header className="mc-board__head">
      <h2 className="mc-board__title" id={ids.boardTitle(board.id)}>
        <BoardIcon board={board.id} />
        <span lang={board.lang}>{board.label}</span>
      </h2>
      <p className="mc-board__counts">
        <CountText
          count={{ n: board.sections.length, one: 'panel', many: 'panels' }}
          uiLang={model.uiLang}
        />
        {records > 0 ? (
          <CountText count={{ n: records, one: 'record', many: 'records' }} uiLang={model.uiLang} />
        ) : null}
      </p>
      {titled.length > 1 ? (
        <ul className="mc-board__index">
          {titled.map((entry) => (
            <li key={entry.id}>
              <a href={entry.href} lang={entry.lang} dir={entry.dir}>
                {entry.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}

/**
 * The colophon: the boards as the page's own index, each to its board's head, whose own index
 * lists its sections (smell 25: the foot isn't a dump of every link above it), then the
 * owner's name and tagline and their ways to reach them.
 */
export function Colophon({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const ids = chromeIds(input.ids.prefix);
  const { footer, uiLang } = model;
  const boards = model.boards;
  return (
    <footer className="mc-colophon">
      {boards.length > 0 ? (
        <nav className="mc-index" aria-labelledby={ids.indexTitle}>
          <h2 id={ids.indexTitle} className="mc-index__title" lang={uiLang}>
            Index
          </h2>
          <ul className="mc-index__boards">
            {boards.map((board) => (
              <li key={board.id} className="mc-index__board">
                <a className="mc-index__head" href={board.href} lang={board.lang}>
                  {board.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <div className="mc-colophon__line">
        <p className="mc-colophon__name">{model.navigation.name.label}</p>
        {/* The identity's tagline beside the name, once on the page: here, unless the anchor's
            lede or role line already says it. */}
        {said(input.portfolio.identity.tagline) &&
        input.portfolio.identity.tagline !== model.lede &&
        input.portfolio.identity.tagline !== model.role?.title ? (
          <p className="mc-colophon__tagline">{input.portfolio.identity.tagline}</p>
        ) : null}
        {footer.email ? (
          <p>
            <a className="mc-link" href={footer.email.href}>
              {footer.email.text}
            </a>
          </p>
        ) : null}
        {footer.links.length > 0 ? (
          <ul className="mc-colophon__links">
            {footer.links.map((link) => (
              <li key={link.href}>
                <Out href={link.href} className="mc-link">
                  {link.text}
                </Out>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </footer>
  );
}
