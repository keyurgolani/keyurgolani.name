import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { sinceYear } from '../model';
import { ownId, uiLang, Words } from '../parts';
import { IndexButton } from './index-sheet';

// The masthead (brief §5.1, component 1; SS-S2): three cells on the 3 px
// rule, the name, where and since when, and the Index. The five parts live
// in the poster's index and the Index sheet, never in a row of links here.
// On a narrow screen the name carries the part the reader is in (S6),
// which the Position controller writes.

export function Masthead({ input }: { input: VariantRenderInput }) {
  const { identity, locale } = input.portfolio;
  const lang = uiLang(locale);
  const since = sinceYear(input);
  const home =
    input.route.route === 'home' ? `#${input.ids.main}` : routeHref(input, { route: 'home' });
  return (
    <header className="ss-masthead">
      <div className="ss-grid ss-masthead__row">
        <p className="ss-masthead__name" data-type-role="body-compact">
          <a href={home}>{identity.name}</a>
          <span
            className="ss-masthead__where"
            id={ownId(input.ids.prefix, 'where')}
            data-type-role="quote"
            aria-hidden="true"
          />
        </p>
        {identity.location || since ? (
          <p className="ss-masthead__cell" data-type-role="body-compact">
            {identity.location}
            {identity.location && since ? ', ' : null}
            {since ? (
              <>
                <Words lang={lang}>working since</Words> <span className="ss-num">{since}</span>
              </>
            ) : null}
          </p>
        ) : null}
        <IndexButton input={input} />
      </div>
    </header>
  );
}
