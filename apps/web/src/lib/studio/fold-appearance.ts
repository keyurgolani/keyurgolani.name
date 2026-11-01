import { applyEdits } from '@portfolio/schema';
import type { SiteEdit } from './appearance';
import type { SourceDocuments } from './documents';

// Save draft from any task (OWN-5): the Appearance workspace's unsaved picks
// and the editor's unsaved text go to the store in one write. The picks are
// made in the site document's text by #4's applyEdits, the call the store's
// draft.applyEdits makes, with its defaults, so the text is what an apply
// would have written; then draft.save sends every document with the version
// Studio read, the one version check. Framework-free, so a test drives it.

export type Folded =
  | { readonly ok: true; readonly documents: SourceDocuments }
  | { readonly ok: false; readonly message: string };

/** `documents` with `edits` made in the site document's text, as the store would make them. */
export function foldAppearance(documents: SourceDocuments, edits: readonly SiteEdit[]): Folded {
  if (edits.length === 0) return { ok: true, documents };
  const site = documents.site;
  try {
    const sourceText = applyEdits(
      site.sourceText,
      site.format,
      edits.map(({ pointer, op, value }) => ({ pointer, op, value })),
    );
    return { ok: true, documents: { ...documents, site: { ...site, sourceText } } };
  } catch {
    return {
      ok: false,
      message:
        "The site document doesn't read, so the appearance picks can't go in it. Fix it in Content's source mode, or Undo the picks, then save.",
    };
  }
}
