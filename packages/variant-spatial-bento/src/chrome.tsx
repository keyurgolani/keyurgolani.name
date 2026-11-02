import { Dialog } from '@portfolio/appearance/primitives';
import {
  present,
  VisitorControlSlot,
  type FooterOutline,
  type PageOutline,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  boardAnchor,
  boardOutline,
  boardPlane,
  boardTarget,
  overviewPlane,
  type Board,
  type Overview,
} from './model';
import { MenuBody } from './menu';
import { formatAddress, outbound } from './parts';
import { Plane } from './plane';
import { StageSlot } from './stage';

// Spatial Bento's chrome. There's no top bar: the page's index is a tile
// of the field, Contents, a row a board, each beside an isometric plane of
// that board's own tiles, which is the spatial stage's still. Each board
// opens with a label on the ground: its name, its plane, and a ruled index
// of its sections. Once the overview scrolls away a dock of the boards
// holds the top edge, and on a phone the hero's Menu opens every board and
// section in a dialog. The reach tile and the footer close the field.

/** The composition's own words, marked English in content that isn't. */
export const uiLangOf = (input: VariantRenderInput) =>
  /^en(?:-|$)/i.test(input.portfolio.locale) ? undefined : 'en';

/** How many sections a board holds, in words. */
const sectionsWord = (count: number) => `${count} ${count === 1 ? 'section' : 'sections'}`;

/** How many works the showcase holds, in words. */
const worksWord = (count: number) => `${count} ${count === 1 ? 'work' : 'works'}`;

/**
 * Where the field's own first entry leads (E2): the showcase's works,
 * Selected work, when the field has them, so a case study is one tap from
 * Contents and the Menu; else the overview itself.
 */
export function firstEntry(input: VariantRenderInput, overview: Overview) {
  return overview.showcase
    ? {
        name: 'Selected work',
        meta: worksWord(overview.works),
        href: `#${input.ids.prefix}${overview.showcase.id}`,
      }
    : { name: 'Overview', meta: 'You are here', href: `#${boardAnchor(input, 'overview')}` };
}

/**
 * Where a board's row in Contents lands: on a section, as the kit's
 * navigation model's destinations do, the one titled as the board when
 * there's one, else its first tile; a board of the full record alone lands
 * on itself. So Contents' Contact is `#contact`, the section, as every
 * composition's is, and the dock, out of sight while Contents shows, keeps
 * the board's own anchor.
 */
export function landingOf(input: VariantRenderInput, board: Board): string {
  const words = (text: string) => text.trim().toLocaleLowerCase();
  const titled = board.tiles.find(
    ({ section }) => present(section.title) && words(section.title) === words(board.name),
  );
  const tile = titled ?? board.tiles[0];
  return tile ? `#${input.ids.prefix}${tile.section.id}` : `#${boardTarget(input, board)}`;
}

/** A board's index without the section that only repeats its name, as About does on the About board. */
const ownEntries = (board: Board, outline: PageOutline) =>
  boardOutline(board, outline).filter(
    (entry) =>
      !present(entry.title) ||
      entry.title.trim().toLocaleLowerCase() !== board.name.toLocaleLowerCase(),
  );

/** The Contents tile: the overview and every board, each a link beside its plane. */
export function Contents({
  input,
  overview,
  boards,
}: {
  readonly input: VariantRenderInput;
  readonly overview: Overview;
  readonly boards: readonly Board[];
}) {
  const uiLang = uiLangOf(input);
  const title = `${input.ids.prefix}sb--contents`;
  const first = firstEntry(input, overview);
  const rows = [
    {
      id: 'overview' as const,
      name: first.name,
      meta: first.meta,
      href: first.href,
      plane: overviewPlane(overview),
      current: true,
    },
    ...boards.map((board) => ({
      id: board.id,
      name: board.name,
      // A board of the full record alone, Record with every section another board's, names its tile.
      meta:
        board.members.length === 0 && board.archive
          ? 'The full record'
          : sectionsWord(board.members.length),
      href: landingOf(input, board),
      plane: boardPlane(board),
      current: false,
    })),
  ];
  return (
    <nav
      className="sb-tile sb-tile--large sb-contents"
      data-area="contents"
      aria-labelledby={title}
      data-rows={rows.length}
    >
      <StageSlot
        seed={input.env.seed}
        idPrefix={input.ids.prefix}
        heading={
          <h2 className="sb-title" id={title} lang={uiLang}>
            Contents
          </h2>
        }
        list={
          <ol className="sb-contents__list" lang={uiLang}>
            {rows.map((row) => (
              <li key={row.id} className="sb-contents__row" data-board={row.id}>
                <a href={row.href} aria-current={row.current ? 'location' : undefined}>
                  <span className="sb-contents__name">{row.name}</span>
                  <span className="sb-contents__meta">{row.meta}</span>
                </a>
                <span className="sb-contents__leader" aria-hidden="true" />
              </li>
            ))}
          </ol>
        }
        models={rows.map((row) => row.plane)}
        planes={rows.map((row) => (
          <span
            key={row.id}
            className={row.current ? 'sb-still__plane sb-still__plane--near' : 'sb-still__plane'}
            data-board={row.id}
          >
            <Plane model={row.plane} raised={row.current} />
          </span>
        ))}
      />
    </nav>
  );
}

/** A board's label, on the ground: its name, its plane, and an index of its sections. */
export function BoardLabel({
  board,
  outline,
  input,
  titleId,
}: {
  readonly board: Board;
  readonly outline: PageOutline;
  readonly input: VariantRenderInput;
  readonly titleId: string;
}) {
  const uiLang = uiLangOf(input);
  const entries = boardOutline(board, outline).flatMap((entry) => {
    const name = present(entry.title) ? entry.title : entry.firstItem?.title;
    return entry.href !== undefined && present(name) ? [{ ...entry, name }] : [];
  });
  return (
    <header className="sb-label" data-area="label" data-rows={board.tallFirst ? 2 : undefined}>
      <h2 className="sb-board__title" id={titleId} lang={uiLang}>
        {board.name}
      </h2>
      <Plane model={boardPlane(board)} raised className="sb-label__plane" />
      {/* An index of nothing is a rule over nothing: a board of the full record alone has none. */}
      {entries.length > 0 ? (
        <ol className="sb-label__index">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a href={entry.href} lang={entry.lang}>
                <span className="sb-label__name">{entry.name}</span>
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </header>
  );
}

/** A postmark: decoration for the tile that says how to reach the owner. */
function Postmark() {
  const waves = [0, 1, 2, 3].map((n) => {
    const y = 22 + n * 9;
    return `M44 ${y} q6 -4 12 0 t12 0 t12 0 t12 0`;
  });
  return (
    <svg className="sb-reach__mark" viewBox="0 0 96 72" aria-hidden="true" focusable="false">
      <circle cx="30" cy="36" r="26" />
      <circle cx="30" cy="36" r="20" />
      {waves.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * The owner's word on answering, for the reach tile: the last sentence of
 * their contact message, when it's short enough to stand alone there ("I
 * read everything; I reply within a week."). The message is the Contact
 * tile's, on its board, in full. There's no clock: the schema has no time zone.
 */
export function replyPromise(message: string | undefined): string | undefined {
  if (!present(message)) return undefined;
  const sentences = sentencesOf(message.trim());
  const last = sentences.at(-1);
  return last !== undefined && last.length <= 64 && sentences.length > 1 ? last : undefined;
}

/** Words that end in a stop without ending a sentence. */
const ABBREVIATION =
  /(?:^|\s)(?:Dr|Mr|Mrs|Ms|Mx|Prof|St|Sr|Jr|Mt|vs|etc|approx|ca|cf|e\.g|i\.e|no)\.$/i;

/**
 * A message's sentences: the platform's sentence breaks, an abbreviation
 * such as "Dr." or "approx." kept with what follows it, so a quoted
 * sentence is always one the owner wrote whole.
 */
export function sentencesOf(text: string): string[] {
  const parts =
    typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map(
          ({ segment }) => segment,
        )
      : (text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text]);
  const sentences: string[] = [];
  let carry = '';
  for (const part of parts) {
    const joined = carry + part;
    if (ABBREVIATION.test(joined.trimEnd())) {
      carry = joined;
      continue;
    }
    carry = '';
    if (joined.trim() !== '') sentences.push(joined.trim());
  }
  if (carry.trim() !== '') sentences.push(carry.trim());
  return sentences;
}

/**
 * How to reach the owner: where they are, when they answer, and the address.
 */
export function Reach({
  input,
  footer,
}: {
  readonly input: VariantRenderInput;
  readonly footer: FooterOutline;
}) {
  const { identity } = input.portfolio;
  const email = footer.email;
  const fallback = email ? undefined : (footer.contact?.links[0] ?? footer.links[0]);
  const promise = replyPromise(footer.contact?.message);
  // With no address and no link, the way is the Contact tile, in the owner's own short message.
  const message = footer.contact?.message?.trim();
  const toContact =
    email || fallback || footer.contactHref === undefined
      ? undefined
      : {
          href: footer.contactHref,
          text: present(message) && message.length <= 64 && !promise ? message : 'Contact',
        };
  // A tile that says how to reach the owner, and can't, isn't one.
  if (!email && !fallback && !toContact) return null;
  return (
    <aside
      className="sb-tile sb-tile--dense sb-tile--accent sb-reach"
      data-area="reach"
      data-ui-surface="accent"
      aria-label={present(identity.location) ? identity.location : footer.name}
    >
      <Postmark />
      {/* Where the owner is; with no place, the hero already says who. */}
      {present(identity.location) ? <p className="sb-reach__where">{identity.location}</p> : null}
      {promise ? <p className="sb-reach__promise">{promise}</p> : null}
      {email ? (
        <p className="sb-reach__mail">
          <a href={email.href}>{email.text}</a>
        </p>
      ) : fallback ? (
        <p className="sb-reach__mail">
          <a href={fallback.href} data-outbound={outbound(fallback.href) ? '' : undefined}>
            {fallback.text}
          </a>
        </p>
      ) : toContact ? (
        <p className="sb-reach__mail">
          <a href={toContact.href}>{toContact.text}</a>
        </p>
      ) : null}
    </aside>
  );
}

/** The menu dialog's local id: `sb-menu`, unless the content holds it, then the first free `sb-menu-<n>`. */
export function menuId(portfolio: VariantRenderInput['portfolio']): string {
  const taken = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (key === 'id' && typeof item === 'string') taken.add(item);
        else walk(item);
      }
    }
  };
  walk(portfolio);
  let id = 'sb-menu';
  for (let n = 2; taken.has(id); n += 1) id = `sb-menu-${n}`;
  return id;
}

/**
 * The phone's menu: a dialog of every board and its sections, Close first.
 * The kit's own Close at the dialog's foot is hidden; Escape closes it too.
 */
export function Menu({
  input,
  overview,
  boards,
  outline,
}: {
  readonly input: VariantRenderInput;
  readonly overview: Overview;
  readonly boards: readonly Board[];
  readonly outline: PageOutline;
}) {
  const uiLang = uiLangOf(input);
  const id = menuId(input.portfolio);
  const first = firstEntry(input, overview);
  return (
    <div className="sb-menu-slot">
      <Dialog
        id={id}
        trigger={<span lang={uiLang}>Menu</span>}
        title={<span lang={uiLang}>Contents</span>}
        closeLabel="Close"
        headingLevel={2}
      >
        <MenuBody id={id} closeLabel="Close" lang={uiLang}>
          <ol className="sb-menu__boards">
            <li>
              <a className="sb-menu__board" href={first.href} lang={uiLang}>
                {first.name}
              </a>
            </li>
            {boards.map((board) => (
              <li key={board.id}>
                <a className="sb-menu__board" href={`#${boardTarget(input, board)}`} lang={uiLang}>
                  {board.name}
                </a>
                <ul className="sb-menu__sections" role="list">
                  {ownEntries(board, outline).map((entry) =>
                    entry.href !== undefined && present(entry.title) ? (
                      <li key={entry.id}>
                        <a href={entry.href} lang={entry.lang}>
                          {entry.title}
                        </a>
                      </li>
                    ) : null,
                  )}
                </ul>
              </li>
            ))}
          </ol>
        </MenuBody>
      </Dialog>
    </div>
  );
}

/** The footer tile: the name, the portfolio's own description, its links, the visitor control, and the way back up. */
export function FooterTile({
  input,
  footer,
  top,
  sheet = false,
  boards = 0,
  record = false,
}: {
  readonly input: VariantRenderInput;
  readonly footer: FooterOutline;
  /** Where Back to top goes: the overview on home, the page's main on a case page. */
  readonly top?: string;
  /** A case page's footer, which says how back to the field, not how round it. */
  readonly sheet?: boolean;
  /** How many boards the field has, and whether a full record opens on it: what the colophon may promise. */
  readonly boards?: number;
  readonly record?: boolean;
}) {
  const uiLang = uiLangOf(input);
  // The links are the Contact ledger's when a contact section renders, so the footer doesn't say them twice.
  const links = footer.contactHref === undefined ? footer.links : [];
  return (
    <footer className="sb-footer">
      <div className="sb-tile sb-tile--dense sb-footer__tile">
        <p className="sb-footer__name">{footer.name}</p>
        <p className="sb-footer__colophon" lang={uiLang} dir={uiLang ? 'ltr' : undefined}>
          {sheet
            ? 'This sheet is one tile of the field, opened: Back to the field returns you to it.'
            : boards === 0
              ? 'Everything here is a tile on one field.'
              : `Every board here is a tile on one field: Contents and the dock take you to any of them${record ? ', and the full record opens in place' : ''}.`}
        </p>
        {links.length > 0 ? (
          <ul className="sb-footer__links" role="list">
            {links.map((link) => (
              <li key={link.href}>
                <a href={link.href} data-outbound={outbound(link.href) ? '' : undefined}>
                  {link.text === link.href ? formatAddress(link.href) : link.text}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="sb-footer__end">
          <VisitorControlSlot />
          <a
            className="sb-footer__top"
            href={top ?? `#${boardAnchor(input, 'overview')}`}
            lang={uiLang}
          >
            Back to top
          </a>
        </div>
      </div>
    </footer>
  );
}
