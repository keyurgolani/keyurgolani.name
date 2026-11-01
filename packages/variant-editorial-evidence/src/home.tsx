import type { HomePageProps } from '@portfolio/kit/sections';
import { Chapter, Rail } from './chapter';
import { Colophon } from './colophon';
import { Masthead } from './masthead';
import { archiveId, homeModel } from './model';
import { Opening } from './opening';

// Editorial Evidence's home page (#13, redesign stream C): a long-form
// issue. The masthead; the opening, with the thesis as the page's one h1;
// the chapters, each an h2 with its sections at h3; and the colophon. The
// same order in the source, on screen, in print, and with no JavaScript.

export function HomePage({ input }: HomePageProps) {
  const model = homeModel(input);
  const first = model.chapters[0];
  return (
    <>
      <Masthead
        input={input}
        folio={first}
        chapters={model.chapters}
        thesis={model.thesisSection?.id}
        archive={model.archive.length > 0 && model.selection ? '#' + archiveId(input) : undefined}
      />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={input.ids.main} className="ee-main" tabIndex={-1}>
        <Opening input={input} model={model} />
        {model.chapters.length > 0 ? (
          <div className="ee-issue">
            <Rail input={input} model={model} />
            <div className="ee-issue__chapters">
              {model.chapters.map((chapter) => (
                <Chapter key={chapter.id} chapter={chapter} input={input} model={model} />
              ))}
            </div>
          </div>
        ) : null}
      </main>
      <Colophon input={input} model={model} />
    </>
  );
}
