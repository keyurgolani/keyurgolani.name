import { isJsonEqual } from '@portfolio/schema';
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
  valueAt,
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
  /** Where to do it alone: `Change it in source mode, portfolio.yml, line 815.` */
  readonly where: string;
  /**
   * What it's about in the fields, by what the item is rather than where it
   * sat in the saved text: the group's key, such as `work:fixture-garden`,
   * and the field's key under it, such as `title`, or null for the item
   * itself. Null when no field shows it: source mode only.
   */
  readonly at: { readonly group: string; readonly field: string | null } | null;
}

/** A finding where the fields show it now, in the working text. */
export interface PlacedFinding {
  readonly view: FindingView;
  /** The working group's pointer. */
  readonly group: string;
  /** The working field's pointer, or null to show it on the item. */
  readonly field: string | null;
  /** Whether what it's about changed since the check, or is gone. */
  readonly stale: boolean;
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
      const found = name === 'portfolio' ? placeIn(groups, finding.pointer) : null;
      // A section the validator named that the saved text doesn't place is its id's.
      const place =
        found && finding.stableId && found.group.key !== `section:${finding.stableId}`
          ? null
          : found;
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
        where,
        at: place
          ? { group: place.group.key, field: place.field?.spec.key ?? null }
          : name === 'portfolio' && finding.stableId
            ? { group: `section:${finding.stableId}`, field: null }
            : null,
      };
    });
}

/** Every finding on a saved draft, described: describeFindings() over the draft's own documents. */
export function describeDraft(draft: StudioDraft, fileName: FileName): readonly FindingView[] {
  return describeFindings(findingsOf(draft), draft.documents, fileName);
}

/**
 * Where each finding shows over the working text. The findings were made on
 * the saved text, whose items may since have moved, gone, or changed kind
 * in source mode, so a finding finds its item by its key, never its saved
 * pointer: its field there when the item still has it, else the item, and
 * the document when the item is gone. A note is stale when what it's about
 * differs from the saved text: the field's value, or the whole item.
 */
export function placeFindings(
  views: readonly FindingView[],
  saved: unknown,
  working: unknown,
): readonly PlacedFinding[] {
  const before = new Map(fieldGroups(saved).map((group) => [group.key, group]));
  const now = new Map(fieldGroups(working).map((group) => [group.key, group]));
  const placed: PlacedFinding[] = [];
  for (const view of views) {
    if (!view.at) continue;
    const target = now.get(view.at.group);
    const origin = before.get(view.at.group);
    if (!target) {
      // The item is gone: the note goes on the document, and what it was about has changed.
      placed.push({ view, group: '', field: null, stale: true });
      continue;
    }
    const field = view.at.field
      ? (target.fields.find((each) => each.spec.key === view.at!.field) ?? null)
      : null;
    if (field) {
      const was = origin?.fields.find((each) => each.spec.key === field.spec.key);
      placed.push({
        view,
        group: target.pointer,
        field: field.pointer,
        stale: !was || was.value !== field.value || was.editable !== field.editable,
      });
      continue;
    }
    // On the item: the document's own notes compare what they point at, an item's the whole item.
    const stale =
      target.key === 'document'
        ? !isJsonEqual(valueAt(saved, view.finding.pointer), valueAt(working, view.finding.pointer))
        : !origin || !isJsonEqual(valueAt(saved, origin.pointer), valueAt(working, target.pointer));
    placed.push({ view, group: target.pointer, field: null, stale });
  }
  return placed;
}

/** A finding in plain words (OWN-3): where it is, as the owner names it, what's wrong, and what next. */
export interface PlainFinding {
  /** The item by its title or name where it has one, such as `Principal Engineer, Reliability, in Chronology`. */
  readonly where: string;
  /**
   * What's wrong, the field in words and never a pointer: `The organization link still points
   * at a sample address.` A key the schema doesn't know is set off in backticks, as code, as in
   * "The key `no such key` isn't a field here".
   */
  readonly what: string;
  /**
   * The one thing to do, and where: the validator's remediation only where it says something
   * `what` doesn't, and never by its pointer, then the place. `Change it in source mode,
   * portfolio.yml, line 815.`
   */
  readonly next: string;
}

/** A sentence's words, lower case, for telling whether two sentences say the same. */
const wordsOf = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/** Whether `sentence` repeats `said`: three words in a row of it are there already. */
function repeats(sentence: string, said: string): boolean {
  const words = wordsOf(sentence);
  const known = ` ${wordsOf(said).join(' ')} `;
  for (let at = 0; at + 3 <= words.length; at += 1) {
    if (known.includes(` ${words.slice(at, at + 3).join(' ')} `)) return true;
  }
  return false;
}

/**
 * The fix line (OWN-3): of the validator's remediation, the sentences that neither name a
 * pointer, which the owner never edits by, nor say again what `what` already said, then where.
 */
function fixLine(remediation: string, what: string, where: string): string {
  const sentences =
    remediation.match(/[^.!?]+[.!?]+/g) ?? (remediation.trim() ? [remediation] : []);
  const kept = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '' && !/\bpointer\b/i.test(sentence))
    .filter((sentence) => !repeats(sentence, what));
  return [kept[0], where].filter(Boolean).join(' ');
}

/** Words a key's parts read as, where its own word isn't what the owner calls it. */
const KEY_WORDS: Readonly<Record<string, string>> = {
  url: 'link',
  href: 'link',
  pdf: 'PDF',
  id: 'ID',
  alt: 'alt text',
};

/** A key in words: `organizationUrl` reads as `organization link`, `pdfUrl` as `PDF link`. */
export function keyWords(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((part) => part !== '')
    .map((part) => KEY_WORDS[part.toLowerCase()] ?? part.toLowerCase())
    .join(' ');
}

/** A field's path under its item in words: `links/0/url` reads as `links, item 1, link`. */
function pathWords(parts: readonly string[]): string {
  return parts
    .map((part) => (/^\d+$/.test(part) ? `item ${Number(part) + 1}` : keyWords(part)))
    .join(', ');
}

const capital = (text: string) =>
  text === '' ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;

/** What an entry is called: the first of the names an entry carries. */
function entryName(entry: unknown): string | null {
  if (entry === null || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  for (const key of ['title', 'name', 'label', 'organization', 'id']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/** Where a finding is, in the owner's words: its item by its title, or its part of the document. */
function whereOf(view: FindingView, path: readonly string[], data: unknown): string {
  if (path.length === 0) return `The whole of ${view.file}`;
  const [first, second] = path as [string, string | undefined];
  if (view.finding.document === 'portfolio' && first === 'identity') return 'Identity';
  if (view.finding.document === 'portfolio' && first === 'meta') return 'Page metadata';
  if (second !== undefined && /^\d+$/.test(second)) {
    const root = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const list = Array.isArray(root[first]) ? (root[first] as unknown[]) : [];
    const name = entryName(list[Number(second)]) ?? `Item ${Number(second) + 1}`;
    return `${name}, in ${capital(keyWords(first))}`;
  }
  return path.length === 1 ? view.file : capital(keyWords(first));
}

/**
 * A finding in the owner's words, from its view and the saved document's
 * plain data: its item by its title, its field as words, and its cause with
 * the validator's leading pointer said as the field the pointer names.
 */
export function plainWords(view: FindingView, data: unknown): PlainFinding {
  const path = segments(view.finding.pointer);
  const head = path.length > 1 && /^\d+$/.test(path[1]!) ? 2 : 1;
  const field =
    path.length > head ? pathWords(path.slice(head)) : path.length === 1 ? keyWords(path[0]!) : '';
  // The validator starts its sentence with the pointer, as source mode reads it.
  // The finding's own pointer where the sentence starts with it, since a key may hold spaces.
  const own = view.finding.pointer;
  const pointer =
    own !== '' && view.cause.startsWith(`${own} `) ? own : /^\/\S*/.exec(view.cause)?.[0];
  const rest = pointer ? view.cause.slice(pointer.length).trim() : view.cause;
  // A key the schema doesn't know is a name, not words: set off as code, so it never runs
  // into the sentence ("The key `no such key` isn't a field here").
  const unknownKey = path.length > 0 && pointer !== undefined && /^isn't a field here\b/.test(rest);
  const subject = unknownKey ? `The key \`${path.at(-1)!}\`` : field === '' ? 'It' : `The ${field}`;
  const what =
    view.finding.code === 'origin.sample'
      ? `${subject} still points at a sample address.`
      : pointer
        ? `${subject} ${rest}`
        : rest;
  return {
    where: whereOf(view, path, data),
    what: capital(what),
    next: fixLine(view.finding.remediation, what, view.where),
  };
}

/** The findings as one line (OWN-3), which opens their list: what they are, counted. */
export function findingsLine(views: readonly FindingView[]): string {
  const count = views.length;
  if (count === 0) return 'No findings.';
  if (views.every((view) => view.finding.code === 'origin.sample')) {
    return count === 1
      ? 'One link still points at a sample address.'
      : `${count} links still point at sample addresses.`;
  }
  const blocking = views.filter((view) => view.finding.severity !== 'warning').length;
  const many = count === 1 ? 'One finding' : `${count} findings`;
  if (blocking === 0) return `${many} to look at before you publish.`;
  if (blocking === count) {
    return count === 1 ? 'One finding blocks publishing.' : `${count} findings block publishing.`;
  }
  return `${many}, ${blocking} of them blocking publishing.`;
}
