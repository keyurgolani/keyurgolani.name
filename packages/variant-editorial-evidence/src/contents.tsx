import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { Chapter } from './navigation';
import { present } from './model';
import { regionId, Words } from './parts';

// The Contents sheet (N2): a print contents page of every section the page
// renders, numbered in its chapter (3.2), a leader to how many items it
// shows, whatever its kind, plus the archive and the résumé, two actions from anywhere on the
// page. The masthead's Contents link points at it:
//
// - With JavaScript, the link opens it as a popover in the top layer
//   (scroll-spy.tsx), focus moves to its first entry, Escape or a click
//   outside closes it and focus goes back to the link, and following a
//   link in it closes it.
// - With none, or where popover isn't supported, the link makes it the
//   page's target, which shows it; following a link in it makes that the
//   target instead, which closes it.
//
// It opens and closes at once: a menu is a high-frequency control, and the
// composition is still (M5).

export const sheetId = (input: Pick<VariantRenderInput, 'ids'>) => regionId(input, 'sheet');

export function ContentsButton({ input }: { input: VariantRenderInput }) {
  return (
    <a
      href={`#${sheetId(input)}`}
      className="ee-masthead__contents"
      aria-haspopup="dialog"
      aria-controls={sheetId(input)}
      data-ee-contents=""
    >
      <Words input={input}>Contents</Words>
    </a>
  );
}

export function ContentsSheet({
  input,
  chapters,
  archive,
  thesis,
}: {
  input: VariantRenderInput;
  /** The issue's chapters, as the home page sets them. */
  chapters: readonly Chapter[];
  /** Where the archive is, when the page has one. */
  archive?: string;
  /** The practice section the opening frames, which the sheet leaves to the opening. */
  thesis?: string;
}) {
  const resume = input.portfolio.links.find((link) => link.platform === 'resume');
  const label = regionId(input, 'sheet-label');
  return (
    // EE's own full-bleed sheet, painted with the language's surface stack (styles.css): the
    // overlay Surface's corner, border and depth are a floating pane's, not a sheet's.
    <div
      id={sheetId(input)}
      className="ee-sheet"
      popover="auto"
      role="dialog"
      aria-labelledby={label}
    >
      <p id={label} className="ee-sheet__label" data-type-role="body-compact">
        <Words input={input}>Contents</Words>
      </p>
      <ol className="ee-sheet__chapters" role="list">
        {chapters.map((chapter) => (
          <li key={chapter.id} className="ee-sheet__chapter">
            <a href={chapter.href} className="ee-sheet__chapter-link">
              <span className="ee-n">{chapter.number}</span>{' '}
              <Words input={input}>{chapter.label}</Words>
            </a>
            <ol role="list" data-type-role="body-compact">
              {chapter.sections
                .filter(
                  (section) =>
                    present(section.title) && section.href !== undefined && section.id !== thesis,
                )
                .map((section, index) => (
                  <li key={section.id}>
                    <a href={section.href} className="ee-sheet__entry" data-ee-section={section.id}>
                      <span className="ee-sheet__no">{`${chapter.number}.${index + 1}`}</span>{' '}
                      <span className="ee-sheet__title" lang={section.lang}>
                        {section.title}
                      </span>
                      {section.count > 0 ? (
                        <>
                          <span className="ee-sheet__leader" aria-hidden="true" />
                          <span className="ee-sheet__count">{section.count}</span>
                        </>
                      ) : null}
                    </a>
                  </li>
                ))}
            </ol>
          </li>
        ))}
      </ol>
      {archive || resume ? (
        <p className="ee-sheet__foot" data-type-role="body-compact">
          {archive ? (
            <a href={archive}>
              <Words input={input}>The archive</Words>
            </a>
          ) : null}
          {resume ? (
            <a href={resume.url}>
              <Words input={input}>Full résumé</Words>
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
