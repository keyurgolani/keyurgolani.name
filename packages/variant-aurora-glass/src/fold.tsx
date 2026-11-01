import type { ReactNode } from 'react';
import type { Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { foldLine, headOf } from './model';
import { Hidden, uiLang, Words } from './parts';

// A fold of the full record (design gate item 8): one more lite of its
// band's pane, a native disclosure whose summary is a row of content, the
// section's heading, the first thing it holds in the owner's words and what
// it holds counted ("3 talks"), with a bead at its start that is hollow
// while closed and filled while open, the bead the chronology rail uses for
// study and work. Inside is the section's own frame, with its id, so a
// fragment link opens it (natively where the engine does, by the sky
// enhancement elsewhere), print opens every one, and with no script it's a
// native disclosure all the same. The frame's own heading is hidden inside
// (styles.css) and still names the section through aria-labelledby; the
// summary's heading keeps the section in heading navigation while closed.

export function Fold({
  section,
  input,
  children,
}: {
  section: Section;
  input: VariantRenderInput;
  children: ReactNode;
}) {
  const lang = uiLang(input.portfolio.locale);
  const head = headOf(section);
  const line = foldLine(section, input);
  return (
    <details className="ag-lite ag-fold" data-ag-fold="">
      <summary className="ag-fold__summary">
        <span className="ag-fold__bead" aria-hidden="true" />
        <h3 className="ag-fold__title" data-type-role="title">
          {head.own ? <Words lang={lang}>{head.title}</Words> : head.title}
        </h3>
        {line.count ? (
          <span className="ag-fold__count ag-num" data-type-role="label">
            <Hidden>, </Hidden>
            <Words lang={lang}>{line.count}</Words>
          </span>
        ) : null}
        {line.first ? (
          <span
            className="ag-fold__first"
            data-type-role="body-compact"
            lang={line.firstLang}
            aria-hidden="true"
          >
            {line.first}
          </span>
        ) : null}
      </summary>
      {children}
    </details>
  );
}
