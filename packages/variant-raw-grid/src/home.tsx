import type { HomePageProps } from '@portfolio/kit/sections';
import { Foot } from './chrome/foot';
import { HeaderRow } from './chrome/header-row';
import { Ticker } from './chrome/ticker';
import { RawGridClient } from './enhancements/raw-grid';
import { bandFrame } from './frame';
import { homeModel } from './model';
import { Opening } from './opening/opening';
import { renderersFor } from './renderers';
import { Sheet } from './sheet';

// Raw Grid's home page: the proof ticker, the header row of cells, then the
// board: the opening (the poster with the page's one h1, the thesis, the
// pinned work), and one sheet per destination in the fixed order, every
// section a band of cells that share their rules. The foot holds the one
// index, the ink block, and the colophon. The same order in the source, on
// screen, in print, and with no JavaScript.

export function HomePage({ input }: HomePageProps) {
  const model = homeModel(input);
  const band = { renderers: renderersFor({ model }), Frame: bandFrame(input, model.uiLang) };
  return (
    <>
      <RawGridClient />
      <Ticker facts={model.ticker} uiLang={model.uiLang} policy={input.presentation.motionPolicy} />
      <HeaderRow input={input} model={model} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={input.ids.main} className="rg-main" tabIndex={-1}>
        <Opening input={input} model={model} />
        {model.sheets.map((sheet) => (
          <Sheet key={sheet.id} sheet={sheet} input={input} model={model} band={band} />
        ))}
      </main>
      <Foot input={input} model={model} />
    </>
  );
}
