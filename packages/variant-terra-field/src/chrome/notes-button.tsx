import { ArcGlyph } from '../field/arc';
import { Words } from '../parts';

// The one control that opens Field notes, wherever it stands: the
// masthead, the marker, and the footer. It invokes the dialog with
// command='show-modal' where the browser supports invoker commands, so it
// opens with no script at all; the field enhancement opens it with
// showModal() where it doesn't.

/** The invoker attributes React passes through as written. */
const invoker = (id: string) =>
  ({ commandfor: id, command: 'show-modal' }) as unknown as Record<string, string>;

export function NotesButton({
  notesId,
  uiLang,
  glyph = true,
  className = 'tf-linkbtn',
}: {
  notesId: string;
  uiLang: 'en' | undefined;
  glyph?: boolean;
  className?: string;
}) {
  return (
    <button
      className={className}
      type="button"
      aria-haspopup="dialog"
      data-tf-notes=""
      {...invoker(notesId)}
    >
      {glyph ? <ArcGlyph /> : null}
      <Words lang={uiLang}>Field notes</Words>
    </button>
  );
}
