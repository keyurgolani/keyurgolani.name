import {
  findingsOf,
  namesIn,
  type DocumentName,
  type DraftFinding,
  type StudioDraft,
} from './documents';
import {
  fieldGroups,
  readDocument,
  sectionItem,
  workItem,
  type BoundField,
  type FieldGroup,
} from './fields';

// Contextual validation (#8, Slice 4): each of #4's findings on the saved
// draft, as the store's validator made it on save, the one boundary source
// mode and publish use too, in the terms the owner edits by. Every finding
// names its document, its stable item, its field, its cause, and the next
// action, and goes beside the field or item it's about. Framework-free, so
// a test drives each.

/** A finding in the owner's terms. */
export interface FindingView {
  readonly finding: DraftFinding;
  /** The document's file, such as portfolio.yml. */
  readonly file: string;
  /** The stable item, such as `Work fixture-garden` or `Identity`. */
  readonly item: string;
  /** The field under the item, such as `title`, or null when it's about the item itself. */
  readonly field: string | null;
  /** What's wrong, as the validator says it. */
  readonly cause: string;
  /** What to do, and where. */
  readonly next: string;
  /** Where it shows in the fields: a field's pointer, a group's, or null for source mode only. */
  readonly at: { readonly group: string; readonly field: string | null } | null;
}

/** What blocks first, then the warnings. */
export const SEVERITY_ORDER = ['blocks-preview', 'blocks-publish', 'warning'] as const;

export const SEVERITY_LABEL: Readonly<Record<string, string>> = {
  'blocks-preview': 'Blocks preview and publishing',
  'blocks-publish': 'Blocks publishing',
  warning: 'Warning',
};

function segments(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Whether `pointer` is `parent` or inside it. */
export function within(pointer: string, parent: string): boolean {
  return parent === '' || pointer === parent || pointer.startsWith(`${parent}/`);
}

/** The group the fields show a pointer in: the deepest that holds it. */
export function placeIn(
  groups: readonly FieldGroup[],
  pointer: string,
): { group: FieldGroup; field: BoundField | null } | null {
  let best: FieldGroup | null = null;
  for (const group of groups) {
    if (!within(pointer, group.pointer)) continue;
    // The document group holds only what no other group does, its own fields among them.
    if (!best || group.pointer.length > best.pointer.length) best = group;
  }
  if (!best) return null;
  const field = best.fields.find((each) => within(pointer, each.pointer)) ?? null;
  return { group: best, field };
}

/** The stable item and field a pointer names in a document's plain data. */
function itemAndField(
  name: DocumentName,
  pointer: string,
  data: unknown,
  stableId: string | undefined,
): { item: string; field: string | null } {
  const path = segments(pointer);
  if (path.length === 0) return { item: 'The whole document', field: null };
  const [first, second] = path;
  const root = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(root[first!]) ? (root[first!] as unknown[]) : null;
  const index = second !== undefined && /^\d+$/.test(second) ? Number(second) : null;
  const rest = (from: number) => (path.length > from ? path.slice(from).join('.') : null);
  if (name === 'portfolio') {
    if (first === 'identity') return { item: 'Identity', field: rest(1) };
    if (first === 'meta') return { item: 'Page metadata', field: rest(1) };
    if (first === 'works' && index !== null) {
      return { item: workItem(list?.[index], index), field: rest(2) };
    }
    if (first === 'sections' && index !== null) {
      const section = list?.[index];
      const item = stableId && !section ? `Section ${stableId}` : sectionItem(section, index);
      return { item, field: rest(2) };
    }
    if (path.length === 1) return { item: 'The portfolio document', field: first! };
  }
  if (index !== null) {
    const entry = list?.[index];
    const id =
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as { id?: unknown }).id === 'string'
        ? (entry as { id: string }).id
        : null;
    return { item: id ? `${first} ${id}` : `${first}, item ${index + 1}`, field: rest(2) };
  }
  return { item: first!, field: rest(1) };
}

/** A document's file name as the owner knows it, such as portfolio.yml. */
export type FileName = (name: DocumentName, format: 'yaml' | 'json') => string;

/**
 * The complete summary's data: each finding in the owner's terms, what
 * blocks first, with its document, stable item, field, cause, and next
 * action. Items are named from `documents`, the text the validator checked.
 * The validation task renders it, and so can anything else that lists
 * findings, such as a publish confirmation.
 */
export function describeFindings(
  findings: readonly DraftFinding[],
  documents: StudioDraft['documents'],
  fileName: FileName,
): readonly FindingView[] {
  const names = namesIn(documents);
  const data = new Map<DocumentName, unknown>();
  for (const name of names) {
    const read = readDocument(documents[name]!);
    data.set(name, read.ok ? read.data : undefined);
  }
  const groups = fieldGroups(data.get('portfolio'));
  const rank = (severity: string) => SEVERITY_ORDER.indexOf(severity as never);
  return [...findings]
    .sort((a, b) => rank(a.severity) - rank(b.severity))
    .map((finding) => {
      const name = (names as readonly string[]).includes(finding.document)
        ? (finding.document as DocumentName)
        : null;
      const document = name ? documents[name] : undefined;
      const file = name && document ? fileName(name, document.format) : finding.document;
      const { item, field } = name
        ? itemAndField(name, finding.pointer, data.get(name), finding.stableId)
        : { item: 'The whole document', field: null };
      const place = name === 'portfolio' ? placeIn(groups, finding.pointer) : null;
      const line = finding.line ? `, line ${finding.line}` : '';
      const where = place?.field
        ? `Change it in the ${place.field.spec.label} field of ${place.group.item}, or in source mode, ${file}${line}.`
        : `Change it in source mode, ${file}${line}.`;
      return {
        finding,
        file,
        item,
        field,
        cause: finding.message,
        next: `${finding.remediation} ${where}`.trim(),
        at: place ? { group: place.group.pointer, field: place.field?.pointer ?? null } : null,
      };
    });
}

/** Every finding on a saved draft, described: describeFindings() over the draft's own documents. */
export function describeDraft(draft: StudioDraft, fileName: FileName): readonly FindingView[] {
  return describeFindings(findingsOf(draft), draft.documents, fileName);
}
