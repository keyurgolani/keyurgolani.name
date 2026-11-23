import type { ReactNode } from 'react';
import type { Work } from '@portfolio/schema';
import { MediaFigure, placedMedia, renderContext, RichText } from '@portfolio/kit/sections';
import type { Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { DiffFile, DiffLine, Note } from './model';
import { Sr, uiLangOf, Who, Words, type Review } from './parts';

// A work as a changed file (issue #270, behaviour 3 and 4): a header with
// its path, its size and a Viewed box, then its diff as a table, unified:
// the old line's number, the new one's, the mark, and the line. A changed
// line's words are <del> and <ins>; a note pins under the line it's on. The
// rest of the work, the case study among it, follows in a body of its own,
// which the enhancement folds behind Expand; without a script every diff is
// whole. The marks, numbers, and hunk rules are the metaphor's, so assistive
// tech hears each line as "Added:" or "Removed:" and its words.

const MARK = { ctx: ' ', add: '+', del: '−' } as const;
const SAID = { ctx: '', add: 'Added: ', del: 'Removed: ' } as const;

type TextLine = Extract<DiffLine, { kind: 'ctx' | 'add' | 'del' }>;

/** A line's words: its tokens, its Markdown, or its text, as a heading, a trailer, or a link. */
function LineText({
  line,
  input,
  lang,
}: {
  line: TextLine;
  input: VariantRenderInput;
  lang: 'en' | undefined;
}) {
  let body: ReactNode;
  if (line.tokens) {
    const Changed = line.kind === 'del' ? 'del' : 'ins';
    body = line.tokens.map((token, i) => (
      <span key={i}>
        {i > 0 ? ' ' : null}
        {token.changed ? <Changed>{token.text}</Changed> : token.text}
      </span>
    ));
  } else if (line.markdown) {
    body = <RichText source={line.text} input={input} className="pr-md" />;
  } else if (line.href) {
    body = <a href={line.href}>{line.text}</a>;
  } else {
    body = line.text;
  }
  return (
    <>
      {line.heading ? (
        <span className="pr-hash" aria-hidden="true">
          #{' '}
        </span>
      ) : null}
      {line.label ? (
        <span className="pr-tl">
          <Words lang={lang}>{line.label}</Words>{' '}
        </span>
      ) : null}
      {body}
    </>
  );
}

/** The diff's columns: the two numbers, the mark, and the line. */
export function Cols() {
  return (
    <colgroup>
      <col className="pr-c-n" />
      <col className="pr-c-n" />
      <col className="pr-c-mk" />
      <col />
    </colgroup>
  );
}

/** A note pinned under a line: the author's notes, or a decision's Why. */
export function NoteBlock({
  note,
  review,
  input,
  lang,
}: {
  note: Note;
  review: Review;
  input: VariantRenderInput;
  lang: 'en' | undefined;
}) {
  return (
    <div className="pr-note" data-kind={note.kind}>
      <p className="pr-note__head">
        <Who review={review} />{' '}
        <span className="pr-chip">
          <Words lang={lang}>{note.kind === 'why' ? 'Why' : 'Author note'}</Words>
        </span>
      </p>
      {note.items.length === 1 ? (
        note.markdown ? (
          <RichText source={note.items[0]!} input={input} className="pr-note__md" />
        ) : (
          <p>{note.items[0]}</p>
        )
      ) : (
        <ul>
          {note.items.map((item, i) => (
            <li key={i}>
              {note.markdown ? <RichText source={item} inline input={input} /> : item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The rows of a run of lines, each note under its line. */
export function Rows({
  lines,
  review,
  input,
}: {
  lines: readonly DiffLine[];
  review: Review;
  input: VariantRenderInput;
}) {
  const lang = uiLangOf(input);
  return (
    <>
      {lines.map((line, i) =>
        line.kind === 'hunk' ? (
          <tr key={i} className="pr-hunk">
            <td className="pr-n" colSpan={2} aria-hidden="true" />
            <td className="pr-tx" colSpan={2}>
              <span aria-hidden="true">@@ </span>
              <Words lang={lang}>{line.label}</Words>
              <span aria-hidden="true"> @@</span>
            </td>
          </tr>
        ) : (
          <Line key={i} line={line} review={review} input={input} lang={lang} />
        ),
      )}
    </>
  );
}

function Line({
  line,
  review,
  input,
  lang,
}: {
  line: TextLine;
  review: Review;
  input: VariantRenderInput;
  lang: 'en' | undefined;
}) {
  return (
    <>
      <tr className="pr-l" data-l={line.kind}>
        <td className="pr-n" aria-hidden="true">
          {line.old ?? ''}
        </td>
        <td className="pr-n" aria-hidden="true">
          {line.new ?? ''}
        </td>
        <td className="pr-mk" aria-hidden="true">
          {MARK[line.kind]}
        </td>
        <td className="pr-tx" data-field={line.field}>
          {SAID[line.kind] ? <Sr lang={lang}>{SAID[line.kind]}</Sr> : null}
          <LineText line={line} input={input} lang={lang} />
        </td>
      </tr>
      {line.note ? (
        <tr className="pr-note-row">
          <td colSpan={4}>
            <NoteBlock note={line.note} review={review} input={input} lang={lang} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Five squares, green for the share of lines added: the file's size at a glance. Decoration. */
export function Squares({ adds, dels, of = 5 }: { adds: number; dels: number; of?: number }) {
  const total = adds + dels;
  const green = total === 0 ? 0 : Math.round((adds / total) * of);
  return (
    <span className="pr-sq" aria-hidden="true">
      {Array.from({ length: of }, (_, i) => (
        <i key={i} data-sq={i < green ? 'a' : 'd'} />
      ))}
    </span>
  );
}

/** A file's +N and −N, each said in words for assistive tech. */
export function Stat({ adds, dels, lang }: { adds: number; dels: number; lang: 'en' | undefined }) {
  return (
    <span className="pr-stat">
      <span className="pr-stat__a">
        <span aria-hidden="true">+</span>
        {adds}
        <Sr lang={lang}> added</Sr>
      </span>{' '}
      <span className="pr-stat__d">
        <span aria-hidden="true">{'−'}</span>
        {dels}
        <Sr lang={lang}> removed</Sr>
      </span>
    </span>
  );
}

/**
 * One file: its header (the fold, the path, linking the work's own page
 * when it has one, New file, its size, and Viewed), its diff, and the
 * work's pictures under it, as a review shows an image that changed.
 */
export function FileBlock({
  file,
  work,
  section,
  input,
  review,
  level,
  anchor,
  whole = false,
}: {
  file: DiffFile;
  work: Work;
  section: Pick<Section, 'id' | 'lang' | 'title'>;
  input: VariantRenderInput;
  review: Review;
  level: 2 | 3 | 4 | 5 | 6;
  anchor?: string;
  /** On the work's own page: the whole diff, nothing behind Expand. */
  whole?: boolean;
}) {
  const lang = uiLangOf(input);
  const ctx = renderContext(input, section, level);
  const Heading = `h${level}` as 'h4';
  const key = `${input.ids.prefix}pr--f-${file.id}${anchor ? '' : `-${section.id}`}`;
  const own = whole ? undefined : review.routed.get(file.id);
  const pictures = [work.cover, ...(work.media ?? [])].flatMap((placement) => {
    const placed = placement ? placedMedia(placement, ctx) : undefined;
    return placed ? [placed] : [];
  });
  const lines = file.more.filter((line) => line.kind !== 'hunk').length;
  return (
    <article
      className="pr-file"
      id={anchor}
      data-pr-file={file.id}
      data-status={file.status}
      aria-labelledby={`${key}-p`}
    >
      <header className="pr-file__head">
        <button
          type="button"
          className="pr-fold"
          data-pr-fold=""
          aria-expanded="true"
          aria-controls={`${key}-b`}
          hidden
        >
          <Sr lang={lang}>Fold {file.path}</Sr>
        </button>
        <Heading className="pr-file__path" id={`${key}-p`}>
          <code>{own ? <a href={own}>{file.path}</a> : file.path}</code>
        </Heading>
        {file.status === 'added' ? (
          <span className="pr-chip pr-chip--new">
            <Words lang={lang}>New file</Words>
          </span>
        ) : null}
        <span className="pr-file__stat">
          <Stat adds={file.adds} dels={file.dels} lang={lang} />
          <Squares adds={file.adds} dels={file.dels} />
        </span>
        <label className="pr-viewed">
          <input type="checkbox" data-pr-viewed={file.id} /> <Words lang={lang}>Viewed</Words>
        </label>
      </header>
      <div className="pr-file__body" id={`${key}-b`}>
        <table className="pr-diff">
          <caption className="pr-sr">
            <Words lang={lang}>Changes to</Words> {file.path}
          </caption>
          <Cols />
          <tbody>
            <Rows lines={file.lines} review={review} input={input} />
          </tbody>
        </table>
        {file.more.length > 0 && !whole ? (
          <p className="pr-exp-row" data-pr-exp-row="" hidden>
            <button
              type="button"
              className="pr-exp"
              data-pr-expand=""
              aria-expanded="true"
              aria-controls={`${key}-m`}
            >
              <span className="pr-exp__t" lang={lang}>
                {file.moreLabel === 'case study' ? 'Expand: the case study' : 'Expand: the details'}
              </span>{' '}
              <span className="pr-exp__n">
                {lines} <Words lang={lang}>{lines === 1 ? 'line' : 'lines'}</Words>
              </span>
            </button>
          </p>
        ) : null}
        {file.more.length > 0 ? (
          <table className="pr-diff" id={`${key}-m`} data-pr-more="">
            <caption className="pr-sr">
              <Words lang={lang}>
                {file.moreLabel === 'case study' ? 'The case study in' : 'The details of'}
              </Words>{' '}
              {file.path}
            </caption>
            <Cols />
            <tbody>
              <Rows lines={file.more} review={review} input={input} />
            </tbody>
          </table>
        ) : null}
        {pictures.length > 0 ? (
          <div className="pr-file__media">
            {pictures.map((placed, i) => (
              <MediaFigure key={i} placed={placed} ctx={ctx} className="pr-fig" />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
