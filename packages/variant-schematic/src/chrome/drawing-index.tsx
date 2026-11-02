import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { sheetSet } from '../model';
import { ownId, Ui, words } from '../parts';
import { IndexControl, TitleBlock } from './title-block';

// The drawing index (brief §5.4, step 4): every sheet and its views by
// reference, S-02 / 3. It's a native <dialog> the enhancement opens from
// the Index buttons, and the same index sits inline in the footer, which is
// where the buttons' plain links land without JS. The phone bar (two
// items: the name and Sheet, SC-S7) and the running marker (the current
// sheet in the bottom-right corner past the cover) open it too.

function IndexList({ input }: { input: VariantRenderInput }) {
  const { sheets, outline } = sheetSet(input);
  const { t, lang } = words(input);
  const { prefix } = input.ids;
  // Off home, every sheet and view is home's, so its links go there.
  const at = input.route.route === 'home' ? '' : routeHref(input, { route: 'home' });
  return (
    <div className="sx-index__list">
      {sheets.map((sheet) => (
        <div key={sheet.id} className="sx-index__sheet">
          {/* The number is inside the link, as on every view row, so the focus ring encloses it (P2 change 7). */}
          <p className="sx-index__head" data-type-role="title">
            <a href={`${at}#${ownId(prefix, `sheet-${sheet.id}`)}`}>
              <span data-type-role="numeric">{sheet.no}</span>{' '}
              <span lang={sheet.lang ?? lang}>{sheet.label}</span>
            </a>
          </p>
          <ol role="list" data-type-role="body-compact">
            {sheet.views.map((view) => (
              <li key={view.section.id}>
                <a href={`${at}#${prefix}${view.section.id}`}>
                  <span className="sx-index__no" data-type-role="numeric">
                    {view.no}
                  </span>
                  <span lang={view.own ? undefined : lang}>{view.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {outline.works.length > 0 ? (
        <div className="sx-index__sheet sx-index__sheet--details">
          <p className="sx-index__head" data-type-role="title">
            <span data-type-role="numeric">W</span> <Ui lang={lang}>{t.details}</Ui>
          </p>
          <ol role="list" data-type-role="body-compact">
            {outline.works.map((work, i) => (
              <li key={work.id}>
                <a
                  href={work.href}
                  lang={work.lang}
                  aria-current={work.current ? 'page' : undefined}
                >
                  <span className="sx-index__no" data-type-role="numeric">
                    {t.detailNo(i + 1)}
                  </span>
                  <span>{work.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** The index inline at the page foot: the no-JS landing for every Index link. */
export function Footer({ input }: { input: VariantRenderInput }) {
  const { t, lang } = words(input);
  const id = ownId(input.ids.prefix, 'index');
  return (
    <footer className="sx-foot">
      <nav className="sx-foot__index" id={id} aria-labelledby={`${id}--h`}>
        <h2 id={`${id}--h`} data-type-role="headline">
          <Ui lang={lang}>{t.drawingIndex}</Ui>
        </h2>
        <IndexList input={input} />
        <p data-type-role="body-compact">
          <a
            href={
              input.route.route === 'home'
                ? `#${input.ids.main}`
                : routeHref(input, { route: 'home' })
            }
          >
            <Ui lang={lang}>{t.backToCover}</Ui>
          </a>
        </p>
      </nav>
      <TitleBlock input={input} at="foot" />
    </footer>
  );
}

/** The index as a dialog, opened by the enhancement; closed, it shows and announces nothing. */
export function IndexDialog({ input }: { input: VariantRenderInput }) {
  const { t, lang } = words(input);
  const id = ownId(input.ids.prefix, 'dialog');
  return (
    <dialog className="sx-dialog" id={id} aria-labelledby={`${id}--h`}>
      <div className="sx-dialog__head">
        <h2 id={`${id}--h`} data-type-role="headline">
          <Ui lang={lang}>{t.drawingIndex}</Ui>
        </h2>
        <button type="button" className="sx-btn" data-sx-close="" data-type-role="label">
          <Ui lang={lang}>{t.close}</Ui>
        </button>
      </div>
      <IndexList input={input} />
    </dialog>
  );
}

/** The phone bar: the name, and Sheet, which names the sheet being read (SC-S7). */
export function PhoneBar({ input, here }: { input: VariantRenderInput; here?: string }) {
  const { t, lang } = words(input);
  return (
    <div className="sx-phone">
      <a className="sx-phone__name" href={`#${input.ids.main}`} data-type-role="title">
        {input.portfolio.identity.name}
      </a>
      <IndexControl input={input} label={t.sheet}>
        <span className="sx-phone__here">
          <span className="sx-hidden">: </span>
          <span data-sx-here="">
            <Ui lang={lang}>{here ?? t.coverSheet}</Ui>
          </span>
        </span>
      </IndexControl>
    </div>
  );
}
