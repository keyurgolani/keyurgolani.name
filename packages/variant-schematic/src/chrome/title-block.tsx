import type { ReactNode } from 'react';
import { VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  currentRole,
  drawingNumber,
  present,
  revisedOf,
  sheetSet,
  titleOf,
  type Sheet,
} from '../model';
import { ownId, Ui, When, words } from '../parts';

// The title block (SC-M1): a ruled block of cells in the bottom-right
// corner of the sheet, where drawings keep it, filled from content alone:
// drawn by (the name), title (the thesis or tagline), the current role, the
// sheet index, sheet n of N, revised (Now's asOf) and the drawing number
// (the name's initials and -001, none without letters). The cover's holds
// the five sheets, the persistent destinations (N1); the page foot's is the
// full block, with the visitor's Appearance control (visitorControl: footer).

export function Cell({
  name,
  lang,
  span = 1,
  kind,
  children,
}: {
  name: string;
  lang?: string;
  span?: 1 | 2 | 3 | 4;
  /** What the cell holds, for a rule that places it (`sheets`). */
  kind?: string;
  children: ReactNode;
}) {
  return (
    <div className="sx-tb__cell" data-span={span} data-cell={kind}>
      <span className="sx-field-name" data-type-role="label">
        <Ui lang={lang}>{name}</Ui>
      </span>
      <span className="sx-tb__value" data-type-role="body-compact">
        {children}
      </span>
    </div>
  );
}

/** The index's open control: a button the enhancement shows, and a plain link to the footer's index meanwhile. */
export function IndexControl({
  input,
  label,
  children,
}: {
  input: VariantRenderInput;
  label?: string;
  children?: ReactNode;
}) {
  const { t, lang } = words(input);
  const index = ownId(input.ids.prefix, 'index');
  const text = label ?? t.index;
  return (
    // One link in every state (P2 quality cells): to the footer's index, which the
    // enhancement makes the dialog's opener, a modified click or a new tab still following it.
    <a className="sx-btn" data-sx-open="" href={`#${index}`} data-type-role="label">
      <Ui lang={lang}>{text}</Ui>
      {children}
    </a>
  );
}

export function SheetLinks({ input, label }: { input: VariantRenderInput; label: string }) {
  const { sheets } = sheetSet(input);
  const { lang } = words(input);
  if (sheets.length === 0) return null;
  return (
    <nav className="sx-sheets" aria-label={label}>
      <ol role="list">
        {sheets.map((sheet) => (
          <li key={sheet.id}>
            <a href={`#${ownId(input.ids.prefix, `sheet-${sheet.id}`)}`} data-sx-sheet={sheet.id}>
              <span className="sx-sheets__no" data-type-role="numeric">
                {sheet.no}
              </span>
              <span lang={sheet.lang ?? lang} data-type-role="body-compact">
                {sheet.label}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A sheet's own corner (SC-M1 on every sheet): the running marker, the
 * sheet's number and Index on an opaque ground, sticky in the sheet's
 * bottom-right corner while the sheet passes and docked on its title block
 * at the sheet's end; then the title block itself: the drawing number, the
 * sheet's title, and which sheet of the set it is.
 */
export function SheetCorner({ input, sheet }: { input: VariantRenderInput; sheet: Sheet }) {
  const { t, lang } = words(input);
  const total = sheetSet(input).sheets.length;
  const dwg = drawingNumber(input.portfolio.identity.name);
  return (
    <>
      <div className="sx-run">
        <span className="sx-run__no" data-type-role="numeric">
          {sheet.no}
        </span>
        <IndexControl input={input} />
      </div>
      <div className="sx-tb" data-at="sheet">
        {dwg ? (
          <Cell name={t.drawing} lang={lang}>
            <span data-type-role="numeric">{dwg}</span>
          </Cell>
        ) : null}
        <Cell name={t.title} lang={lang} span={dwg ? 2 : 3}>
          <span lang={sheet.lang ?? lang}>{sheet.label}</span>
        </Cell>
        <Cell name={t.sheet} lang={lang}>
          <span data-type-role="numeric">{t.nOf(sheet.n, total)}</span>
        </Cell>
      </div>
    </>
  );
}

/** Where a run of cells ends, in columns, as the grid places them: a cell that won't fit its row starts the next. */
function packed(spans: readonly number[]): number {
  let used = 0;
  for (const span of spans.filter((n) => n > 0)) {
    const row = used % 4;
    used += row + span > 4 ? 4 - row + span : span;
  }
  return used;
}

export function TitleBlock({ input, at }: { input: VariantRenderInput; at: 'cover' | 'foot' }) {
  const { t, lang } = words(input);
  const { identity } = input.portfolio;
  const set = sheetSet(input);
  const role = currentRole(input);
  const title = titleOf(input);
  const revised = revisedOf(input);
  const dwg = drawingNumber(identity.name);
  const total = set.sheets.length;
  const cover = at === 'cover';
  const hero = set.cover?.kind === 'hero' ? set.cover : undefined;
  const heroTitle = hero && present(hero.title) ? hero.title : undefined;
  const heroLang = (hero as { lang?: string } | undefined)?.lang;
  // The foot's cells before the sheet count, in columns, so the count can end its row.
  const before = [
    title ? 1 : 3,
    title ? 2 : 0,
    dwg ? 1 : 0,
    role ? 3 : 0,
    revised ? 1 : 0,
    present(identity.location) ? 2 : 0,
  ];
  const sheetsSpan = (4 - (packed(before) % 4)) as 1 | 2 | 3 | 4;
  return (
    <div className="sx-tb" data-at={at}>
      {cover ? (
        <>
          <div className="sx-tb__cell sx-tb__nav" data-span={3}>
            <span className="sx-field-name" data-type-role="label">
              <Ui lang={lang}>{t.sheets}</Ui>
            </span>
            <SheetLinks input={input} label={t.sheets} />
          </div>
          <div className="sx-tb__cell sx-tb__here" data-span={1}>
            <span className="sx-tb__sheet" data-type-role="label">
              <Ui lang={lang}>{t.coverSheet}</Ui>
            </span>
            {/* The hero's own title, when it has one, names the cover sheet, in its own language. */}
            {heroTitle ? (
              <span
                className="sx-tb__sheet-title"
                data-type-role="body-compact"
                lang={heroLang}
                title={heroTitle}
              >
                {heroTitle}
              </span>
            ) : null}
            <span className="sx-hidden">
              <Ui lang={lang}>{t.sheetsFollow(total)}</Ui>
            </span>
            <IndexControl input={input} />
          </div>
        </>
      ) : null}
      <Cell name={t.drawnBy} lang={lang} span={title ? 1 : 3}>
        {identity.name}
        {present(identity.pronouns) ? (
          <span className="sx-muted"> ({identity.pronouns})</span>
        ) : null}
      </Cell>
      {title ? (
        <Cell name={t.title} lang={lang} span={2}>
          {title}
        </Cell>
      ) : null}
      {dwg ? (
        <Cell name={t.drawing} lang={lang}>
          <span data-type-role="numeric">{dwg}</span>
        </Cell>
      ) : null}
      {role ? (
        <Cell name={t.current} lang={lang} span={3}>
          {role.title}
          {present(role.organization) ? `, ${role.organization}` : null}
        </Cell>
      ) : null}
      {revised ? (
        <Cell name={t.revised} lang={lang}>
          <When raw={revised} input={input} />
        </Cell>
      ) : null}
      {!cover && present(identity.location) ? (
        <Cell name={t.location} lang={lang} span={2}>
          {identity.location}
        </Cell>
      ) : null}
      {cover ? null : (
        <>
          {/* The sheet count takes the rest of its row, and the control a row of its own,
              so no cell sits empty, with the control or without it (P2 design review). */}
          <Cell name={t.sheets} lang={lang} span={sheetsSpan} kind="sheets">
            <span data-type-role="numeric">{total}</span>
          </Cell>
          <div className="sx-tb__cell sx-tb__control" data-span={4}>
            <VisitorControlSlot />
          </div>
        </>
      )}
    </div>
  );
}
