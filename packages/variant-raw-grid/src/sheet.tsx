import type { ReactElement } from 'react';
import { renderSection, type SectionComposition } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, countOf, type HomeModel, type Sheet as SheetModel } from './model';
import { Fold, foldedLast, folds } from './fold';
import { Fit, Words } from './parts';

// A destination's sheet: its word at display size in the first cell, a
// table of its sections in the next (none when it holds one), then each
// section as a band of cells, two short neighbours sharing a row, and last
// the full record's minor parts, each folded (fold.tsx). Each sheet is a
// region, an h2, its sections h3.

function Contents({
  sheet,
  input,
  uiLang,
}: {
  sheet: SheetModel;
  input: VariantRenderInput;
  uiLang: 'en' | undefined;
}) {
  const listed = foldedLast(
    sheet,
    sheet.toc.filter((entry) => entry.title !== undefined && entry.href !== undefined),
    input,
  );
  if (listed.length < 2) return null;
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  return (
    <nav
      className="rg-cell rg-sheet__toc"
      aria-labelledby={chromeIds(input.ids.prefix).sheetTitle(sheet.id)}
    >
      <ul role="list">
        {listed.map((entry) => {
          const section = byId.get(entry.id);
          const count = section ? countOf(section, input) : undefined;
          return (
            <li key={entry.id}>
              <a href={entry.href} lang={entry.lang} dir={entry.dir}>
                <span>{entry.title}</span>
                {count && count.n > 0 ? (
                  <span className="rg-num rg-count">
                    {count.n}
                    <span className="rg-hidden">
                      <Words lang={uiLang}> {count.unit}</Words>
                    </span>
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sheet({
  sheet,
  input,
  model,
  band,
}: {
  sheet: SheetModel;
  input: VariantRenderInput;
  model: HomeModel;
  band: SectionComposition;
}): ReactElement {
  const ids = chromeIds(input.ids.prefix);
  const folded = sheet.rows.flat().filter((section) => folds(sheet, section, input));
  const rows = sheet.rows
    .map((row) => row.filter((section) => !folded.includes(section)))
    .filter((row) => row.length > 0);
  return (
    <section
      className="rg-sheet"
      id={ids.sheet(sheet.id)}
      aria-labelledby={ids.sheetTitle(sheet.id)}
      data-sheet={sheet.id}
    >
      <div className="rg-field">
        <div className="rg-band rg-sheet__head">
          <h2 className="rg-cell rg-sheet__word" id={ids.sheetTitle(sheet.id)} lang={sheet.lang}>
            <Fit text={sheet.label} />
          </h2>
          <Contents sheet={sheet} input={input} uiLang={model.uiLang} />
        </div>
        {rows.map((row) =>
          row.length === 1 ? (
            renderSection(row[0]!, input, band, { level: 3 })
          ) : (
            <div key={row.map(({ id }) => id).join(' ')} className="rg-pair">
              {row.map((section) => renderSection(section, input, band, { level: 3 }))}
            </div>
          ),
        )}
        {folded.map((section) => {
          const element = renderSection(section, input, band, { level: 3 });
          return element ? (
            <Fold key={`fold-${section.id}`} section={section} input={input} uiLang={model.uiLang}>
              {element}
            </Fold>
          ) : null;
        })}
      </div>
    </section>
  );
}
