import type { ReactNode } from 'react';
import type { Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { foldLine, headOf, present, splitAside } from './model';
import { Paren, uiLang, Words } from './parts';

// The full record's disclosures (design gate item 8): a section home shows
// closed, as Swiss shows anything it holds back, a ruled head band with the
// title and its parenthetical count as the native <summary>, and the
// section's own frame inside, with its id, so a fragment link to it opens
// the disclosure natively, the Position controller opens it where the
// browser doesn't, and print opens every one. With no script it's a native
// disclosure all the same. Closed, the summary is a ruled table row on the
// column lines: the title (with the owner's own aside, if any), the first
// thing it holds, or for a chronology the latest role, and what it holds
// counted in its own noun at the end, "3 photographs", so a column of folds
// reads as a list of things (lead A's ruling, design review item 10).

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
  const head = headOf(section, input);
  const aside = present(section.title) ? splitAside(section.title!).aside : undefined;
  const line = foldLine(section, input);
  return (
    <details className="ss-fold" data-ss-fold="">
      <summary className="ss-fold__summary">
        {/* The section's heading, in the summary, so a closed fold stays in heading
            navigation; the frame's own heading inside is display: none (styles.css),
            still naming the section through aria-labelledby. */}
        <h3 className="ss-fold__title" data-type-role="title">
          {head.hidden ? <Words lang={lang}>{head.title}</Words> : head.title}
          {aside ? (
            <>
              {' '}
              <Paren>{aside}</Paren>
            </>
          ) : null}
        </h3>
        {/* The first item is the content's own first line: shown closed, never read twice. */}
        {line.first ? (
          <span
            className="ss-fold__first"
            data-type-role="body-compact"
            lang={line.firstLang}
            aria-hidden="true"
          >
            {line.first}
          </span>
        ) : null}
        {line.count ? (
          <span className="ss-fold__count ss-num" data-type-role="body-compact">
            <span className="ss-hidden">, </span>
            <Words lang={lang}>{line.count}</Words>
          </span>
        ) : null}
      </summary>
      {children}
    </details>
  );
}
