import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, type HomeModel } from '../model';
import { Fit, Words } from '../parts';
import { indexColumns } from './foot';

// The header row: one sticky row of cells on the twelve columns. The name
// (1 to 3), the five destinations each with how many sections it holds
// (4 to 8), a "where you are" cell (9 to 11), and the Index (12). Under
// 75rem the destinations fold into the Index; under 48rem it's the name
// and the Index alone. The where cell is a sighted aid the client module
// keeps current, hidden from assistive technology, which hears the
// destinations' aria-current instead. Without a script, the Index is a
// link to the index in the foot. On a work's own page the destinations
// lead back to their sheets on home, Work is marked current (aria-current
// "true": the page is within Work, not Work itself), and the where cell
// rests on the case. A slash parts its two words only when they are a
// place and its title (data-pair), never home's counts. Each link sits a
// ring's reach inside its ruled cell (rg-go), so its focus ring lies on the
// cell's ground, never on a rule.

export function HeaderRow({
  input,
  model,
  current,
  home = '',
  rest,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  current?: string;
  /** Home's path, for a page that isn't home: its sheets are there. */
  home?: string;
  /** The where cell's resting words, when not home's counts. */
  rest?: readonly [string, string];
}) {
  const ids = chromeIds(input.ids.prefix);
  const { navigation, uiLang } = model;
  const sheets = new Set(model.sheets.map(({ id }) => id));
  return (
    <header className="rg-head">
      <nav className="rg-head__row" aria-label="Site">
        <span className="rg-head__name">
          <a className="rg-go" href={navigation.name.href}>
            <Fit text={navigation.name.label} />
          </a>
        </span>
        {navigation.primary.length > 0 ? (
          <ul className="rg-head__dests" role="list">
            {navigation.primary.map((destination) => (
              <li key={destination.id}>
                <a
                  className="rg-go rg-head__dest"
                  href={
                    sheets.has(destination.id)
                      ? `${home}#${ids.sheet(destination.id)}`
                      : destination.href
                  }
                  lang={destination.lang}
                  data-dest={destination.id}
                  // The work's own page sits under Work: Work is current, not this page itself.
                  aria-current={destination.id === current ? 'true' : undefined}
                >
                  <span>{destination.label}</span>
                  <span className="rg-num rg-count">
                    {destination.sections.length}
                    <span className="rg-hidden">
                      <Words lang={uiLang}>
                        {destination.sections.length === 1 ? ' section' : ' sections'}
                      </Words>
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="rg-head__where" aria-hidden="true" data-pair={rest ? '' : undefined}>
          <span className="rg-head__where-k">
            <Words lang={uiLang}>{rest?.[0] ?? `${model.sectionCount} sections`}</Words>
          </span>{' '}
          <span className="rg-head__where-v">
            <Words lang={uiLang}>
              {rest?.[1] ??
                `in ${model.sheets.length + (model.contact || model.cta ? 1 : 0)} sheets`}
            </Words>
          </span>
        </p>
        {indexColumns(input, model).length > 0 ? (
          <span className="rg-head__index">
            <a className="rg-go" href={`#${ids.index}`} data-rg-index="">
              <span className="rg-burger" aria-hidden="true" />
              <Words lang={uiLang}>Index</Words>
            </a>
          </span>
        ) : null}
      </nav>
    </header>
  );
}
