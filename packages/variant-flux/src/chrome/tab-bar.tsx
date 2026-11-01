import { VisitorControlSlot } from '@portfolio/kit/sections';
import { MotionControl } from '@portfolio/kit/runtime';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { openingHeading } from '../hero';
import type { Sheet, SheetId } from '../model';
import { ownId, uiLang, Words } from '../parts';
import { IndexButton } from './index-dialog';

// The melting tab bar (brief §5.10, step 4; FX-M3, N8: Flux's form, never a
// capsule). No container: inline at the top left from 40rem, on a strip the
// width of the page that only fills in once the page scrolls, and docked to
// the bottom on phones alone. The name, then K-1's five destinations, then
// the tools: Index, Pause and the visitor's Appearance control. One liquid
// drop is its only filled shape: it sits under the place being read, the
// name until a sheet comes up, and when the place changes it stretches
// toward the new tab and snaps in (the enhancement; S4: a keyboard move
// lands at once). It lies under the row, and the labels it passes under
// turn to the inverse ink, so every word paints itself, over the drop or
// the page. With no script the drop is the name's own fill and every link
// works.

/** What Pause says in each state, in the composition's words. */
const PAUSE_STATUS = {
  running: 'The field drifts while it shows',
  paused: 'The field is paused',
  reduced: 'Held still: your device asks for less motion',
} as const;

function Tabs({
  input,
  sheets,
  here,
}: {
  input: VariantRenderInput;
  sheets: readonly Sheet[];
  here?: SheetId;
}) {
  const lang = uiLang(input.portfolio.locale);
  const { prefix } = input.ids;
  const home = input.route.route === 'home' ? '' : routeHref(input, { route: 'home' });
  const destinations = sheets.filter((sheet) => sheet.id !== 'more');
  return (
    <ul className="fx-tabs" role="list">
      <li className="fx-tabs__name">
        <a
          className="fx-tab fx-tab--name"
          href={`${home}#${openingHeading(input)}`}
          data-fx-tab="top"
          data-type-role="label"
        >
          <span className="fx-tab__word">{input.portfolio.identity.name}</span>
        </a>
      </li>
      {destinations.map((sheet) => (
        <li
          key={sheet.id}
          className="fx-tabs__dest"
          data-fx-tab={sheet.id}
          data-current={sheet.id === here ? '' : undefined}
        >
          <a
            className="fx-tab"
            href={`${home}#${ownId(prefix, `sheet-${sheet.id}`)}`}
            data-fx-tab={sheet.id}
            data-type-role="label"
          >
            <span className="fx-tab__word">
              {sheet.own ? <Words lang={lang}>{sheet.word}</Words> : sheet.word}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * `here` is the destination a page other than home belongs to, such as Work on a work's own page:
 * its tab is marked from the server, and the drop sits under it.
 */
export function TabBar({
  input,
  sheets,
  here,
}: {
  input: VariantRenderInput;
  sheets: readonly Sheet[];
  here?: SheetId;
}) {
  const lang = uiLang(input.portfolio.locale);
  return (
    <header className="fx-bar" id={ownId(input.ids.prefix, 'bar')}>
      <div className="fx-bar__in">
        <nav className="fx-bar__nav" aria-label="Primary">
          <span className="fx-bar__drop" aria-hidden="true" />
          <Tabs input={input} sheets={sheets} here={here} />
        </nav>
        <div className="fx-bar__tools">
          <IndexButton input={input}>
            <span className="fx-bar__word">
              <Words lang={lang}>Index</Words>
            </span>
          </IndexButton>
          <span className="fx-pause" lang={lang}>
            <MotionControl
              className="fx-pause__control"
              label="Pause"
              policy={input.presentation.motionPolicy}
              status={PAUSE_STATUS}
            />
          </span>
          <span className="fx-bar__appearance">
            <VisitorControlSlot />
          </span>
        </div>
      </div>
    </header>
  );
}
