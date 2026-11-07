import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { openingHeading } from '../hero';
import type { Band } from '../model';
import { ownId, uiLang, Words } from '../parts';
import { IndexButton } from './index-dialog';
import { Ornament, PauseButton } from './ornament';
import { MenuWord } from './phone-bar';

// The capsule (brief §5.2, step 4; N8: Aurora owns the capsule): one
// floating glass pill, centred over the page's grid. The name on the start
// (home), up to four destinations in the middle, the Index, and the filled
// call to action on the end, which is the Contact destination: five
// destinations at most (N1). The ornament, Pause and the visitor's control,
// is its one companion group on the page's end column line (AG-S2); below
// 75rem Pause moves into the capsule as its last item (ornament.tsx). On a
// phone the destinations fold into the Index, which the capsule's button
// names "Menu", so persistent chrome is the name and that one button.

export function Chrome({ input, bands }: { input: VariantRenderInput; bands: readonly Band[] }) {
  const lang = uiLang(input.portfolio.locale);
  const { prefix } = input.ids;
  const onHome = input.route.route === 'home';
  const home = onHome ? '' : routeHref(input, { route: 'home' });
  const destinations = bands.filter((band) => band.id !== 'more');
  const contact = destinations.find((band) => band.id === 'contact');
  const middle = destinations.filter((band) => band.id !== 'contact').slice(0, 4);
  const link = (band: Band) => `${home}#${ownId(prefix, `band-${band.id}`)}`;
  return (
    <header className="ag-chrome">
      <nav className="ag-capsule ag-frost" aria-label="Primary">
        <a
          className="ag-capsule__name"
          href={`${home}#${openingHeading(input)}`}
          data-type-role="title"
        >
          {input.portfolio.identity.name}
        </a>
        {middle.length > 0 ? (
          <ul className="ag-capsule__dest" role="list">
            {middle.map((band) => (
              <li key={band.id}>
                <a href={link(band)} data-ag-dest={band.id} data-type-role="label">
                  {band.own ? <Words lang={lang}>{band.word}</Words> : band.word}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {/* The Index lists the bands: with none, there's nothing to open (row 62). */}
        {bands.length > 0 ? (
          <IndexButton input={input}>
            <MenuWord lang={lang} />
          </IndexButton>
        ) : null}
        {contact ? (
          <a
            className="ag-capsule__cta"
            href={link(contact)}
            data-ag-dest="contact"
            data-type-role="label"
          >
            <span className="ag-capsule__cta-text">
              {contact.own ? <Words lang={lang}>{contact.word}</Words> : contact.word}
            </span>
          </a>
        ) : null}
        <PauseButton input={input} place="capsule" />
      </nav>
      <Ornament input={input} />
    </header>
  );
}
