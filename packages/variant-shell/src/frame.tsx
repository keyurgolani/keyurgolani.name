import type { ReactNode } from 'react';
import type { SectionFrame } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  commandFor,
  controlsOf,
  foldOf,
  KIND_LABELS,
  promptOf,
  type Fold,
  type TranscriptEntry,
} from './model';
import { CommandLine, CommandText, Ps1, Sr, uiLangOf, Words } from './parts';

// The shell frame (brief §5.6 step 3): each section as three lines, the
// owner's title as a shell comment (the h2, its `#` hidden), the prompt and
// the command that prints it (aria-hidden), then its output. The gap before
// it is the transcript's rhythm in rows: 1 inside a directory, 2 at a
// change. A section the kit renders (custom, an extension's) brings its
// own heading, so its frame adds only the command.

export function shellFrame(
  input: VariantRenderInput,
  plan: ReadonlyMap<string, TranscriptEntry>,
): SectionFrame {
  const uiLang = uiLangOf(input);
  const { commands, prompt } = controlsOf(input);
  const entries = [...plan.values()];
  const previousOf = (entry: TranscriptEntry) => entries[entries.indexOf(entry) - 1]?.cwd ?? '~';
  return function ShellFrame({ frame, section, level, children }) {
    const entry = plan.get(section.id);
    const cwd = entry?.cwd ?? '~';
    const Heading = `h${level}` as 'h2';
    const headingId = `${frame.id ?? section.id}--h`;
    const shared = frame['data-renderer'] === 'shared';
    // The hero's renderer writes the page's h1 under this id: the whoami output leads with it.
    const own = shared || section.kind === 'hero';
    const title = section.title?.trim();
    const fold = own || !entry ? undefined : foldOf(section, entry.destination, input);
    if (fold) {
      return (
        <Folded
          fold={fold}
          gap={entry!.gap}
          cd={
            entry!.gap === 2 && commands === 'shown' ? (
              <p className="sh-cd" aria-hidden="true">
                <Ps1 prompt={promptOf(input)} cwd={previousOf(entry!)} style={prompt} /> cd {cwd}
              </p>
            ) : null
          }
          summary={
            <>
              <span className="sh-fold__cmt">
                <span className="sh-cmt__hash" aria-hidden="true">
                  #{' '}
                </span>
                {title ?? <Words lang={uiLang}>{KIND_LABELS[section.kind] ?? section.kind}</Words>}
              </span>
              {commands === 'shown' ? (
                <span className="sh-cmd sh-fold__cmd" aria-hidden="true">
                  <CommandText
                    input={input}
                    cwd={cwd}
                    command={commandFor(section, input)}
                    style={prompt}
                  />
                </span>
              ) : null}
              <span className="sh-fold__meta">
                {fold.count > 0 ? (
                  <>
                    <span className="sh-fig">{fold.count}</span>{' '}
                    <Words lang={uiLang}>{fold.unit}</Words>
                    {fold.first ? ': ' : null}
                  </>
                ) : null}
                {fold.first ? <span lang={section.lang}>{fold.first}</span> : null}
              </span>
            </>
          }
        >
          <section
            {...frame}
            className="sh-block"
            data-gap={entry!.gap}
            data-cwd={cwd}
            data-dest={entry!.destination ?? 'home'}
            aria-labelledby={headingId}
          >
            {/* The summary prints the title and the command; the heading names the section. */}
            <Heading className="sh-sr" id={headingId}>
              {title ?? <Words lang={uiLang}>{KIND_LABELS[section.kind] ?? section.kind}</Words>}
            </Heading>
            {section.subtitle ? (
              <p className="sh-sub">
                <span className="sh-cmt__hash" aria-hidden="true">
                  #{' '}
                </span>
                {section.subtitle}
              </p>
            ) : null}
            <div className="sh-out">{children}</div>
          </section>
        </Folded>
      );
    }
    return (
      <section
        {...frame}
        className="sh-block"
        data-gap={entry?.gap ?? 0}
        data-cwd={cwd}
        data-dest={entry?.destination ?? 'home'}
        aria-labelledby={shared ? undefined : headingId}
      >
        {entry && entry.gap === 2 && commands === 'shown' ? (
          // A directory change, as a shell shows one: the session moves there.
          <p className="sh-cd" aria-hidden="true">
            <Ps1 prompt={promptOf(input)} cwd={previousOf(entry)} style={prompt} /> cd {cwd}
          </p>
        ) : null}
        {own ? null : title ? (
          <Heading className="sh-cmt" id={headingId}>
            <span className="sh-cmt__hash" aria-hidden="true">
              #{' '}
            </span>
            {title}
          </Heading>
        ) : (
          <Heading className="sh-sr" id={headingId}>
            <Words lang={uiLang}>{KIND_LABELS[section.kind] ?? section.kind}</Words>
          </Heading>
        )}
        {!own && section.subtitle ? (
          <p className="sh-sub">
            <span className="sh-cmt__hash" aria-hidden="true">
              #{' '}
            </span>
            {section.subtitle}
          </p>
        ) : null}
        {commands === 'shown' ? (
          <CommandLine
            input={input}
            cwd={cwd}
            command={commandFor(section, input)}
            style={prompt}
          />
        ) : null}
        <div className="sh-out">{children}</div>
      </section>
    );
  };
}

/**
 * A folded section (gate item 8): a closed native disclosure whose summary is the section's
 * comment, its command line and the first line of what it prints (how many, and the first),
 * the output a press away. The section, with its id, is inside, so a fragment into it opens it
 * in the browser with no script; the enhancement opens it too, and every fold for print. The
 * directory change before it stays out, so it shows folded.
 */
function Folded({
  fold,
  gap,
  cd,
  summary,
  children,
}: {
  fold: Fold;
  gap: 0 | 1 | 2;
  cd: ReactNode;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sh-foldblock" data-gap={gap} data-count={fold.count}>
      {cd}
      <details className="sh-fold" data-sh-fold="">
        <summary className="sh-fold__sum">{summary}</summary>
        {children}
      </details>
    </div>
  );
}

export { Sr };
