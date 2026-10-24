import { applyEdits, jsonIndent, parseSource, toPointer, WORK_MEDIA } from '@portfolio/schema';
import type { SourceDocument } from './documents';

// Structured fields over the working draft (#8, Slice 4 items 1 and 2): the
// portfolio's common content as fields, read from the same text source
// mode edits. Framework-free, so a test drives every edit.
//
// A field reads its value from the document as written, parsed as plain
// data and never through the schemas: Zod parsing drops unknown keys and
// fills defaults, so a model written back would lose data. An edit goes
// through #4's applyEdits, which changes only the value it sets, so
// comments, key order, a safe extension field under `extensions`, and any
// other key stay as written. A key no schema knows stays in the text too,
// and the store's validator reports it on save, beside its item here and in
// the summary.

export type FieldKind = 'text' | 'long' | 'choice';

export interface FieldSpec {
  /** The key under the item, such as `title`. */
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  /**
   * A required field keeps its key when it's emptied, so the validator says
   * it's blank. An optional one emptied is left out, as #10's authored
   * absence reads it.
   */
  readonly required?: boolean;
  /** For `choice`, the values it offers; '' is "left out" for an optional one. */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** For `text`, values the browser suggests, though any is accepted. */
  readonly suggestions?: readonly string[];
}

/** One field as the document holds it now. */
export interface BoundField {
  readonly spec: FieldSpec;
  /** JSON pointer into the portfolio document. */
  readonly pointer: string;
  /** The value as text: '' when it's left out. */
  readonly value: string;
  /** False when the document holds something here a text field can't show, such as a list. */
  readonly editable: boolean;
}

/** An object in the document the fields edit: the identity, a work, a section. */
export interface FieldGroup {
  /** JSON pointer to the object, '' for the document itself. */
  readonly pointer: string;
  /** The stable item as the owner reads it, such as `Work fixture-garden`. */
  readonly item: string;
  /** Read-only facts about it, such as its stable id. */
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly fields: readonly BoundField[];
  /** The namespaces under its `extensions`, which the fields never touch. */
  readonly extensions: readonly string[];
}

const text = (key: string, label: string, required = false): FieldSpec => ({
  key,
  label,
  kind: 'text',
  ...(required ? { required } : {}),
});
const long = (key: string, label: string, required = false): FieldSpec => ({
  key,
  label,
  kind: 'long',
  ...(required ? { required } : {}),
});

const DOCUMENT_FIELDS: readonly FieldSpec[] = [
  text('locale', 'Language tag', true),
  {
    key: 'direction',
    label: 'Writing direction',
    kind: 'choice',
    required: true,
    options: [
      { value: 'ltr', label: 'Left to right' },
      { value: 'rtl', label: 'Right to left' },
    ],
  },
];

const IDENTITY_FIELDS: readonly FieldSpec[] = [
  text('name', 'Name', true),
  text('tagline', 'Tagline'),
  text('pronouns', 'Pronouns'),
  text('location', 'Location'),
  text('email', 'Email'),
];

const META_FIELDS: readonly FieldSpec[] = [
  text('title', 'Page title'),
  long('description', 'Page description'),
];

const WORK_FIELDS: readonly FieldSpec[] = [
  text('title', 'Title', true),
  { ...text('medium', 'Medium', true), suggestions: WORK_MEDIA },
  {
    key: 'visibility',
    label: 'Visibility',
    kind: 'choice',
    options: [
      { value: '', label: 'Left out (public)' },
      { value: 'public', label: 'Public' },
      { value: 'private', label: 'Private' },
    ],
  },
  long('summary', 'Summary'),
  long('description', 'Description'),
  text('role', 'Role'),
  text('organization', 'Organization'),
  text('url', 'Link'),
];

/** The fields each section kind adds to its title and subtitle. */
const SECTION_FIELDS: Readonly<Record<string, readonly FieldSpec[]>> = {
  hero: [
    text('greeting', 'Greeting'),
    text('name', 'Name'),
    text('tagline', 'Tagline'),
    text('subtagline', 'Subtagline'),
  ],
  lede: [long('body', 'Body', true)],
  now: [text('asOf', 'As of'), long('body', 'Body', true)],
  quote: [
    long('text', 'Quote', true),
    text('attribution', 'Attribution'),
    text('source', 'Source'),
    text('sourceUrl', 'Source link'),
  ],
  custom: [long('body', 'Body')],
  cta: [long('description', 'Description')],
  github: [text('username', 'GitHub username', true)],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bind(data: Record<string, unknown> | undefined, path: readonly (string | number)[]) {
  return (spec: FieldSpec): BoundField => {
    const value = data && Object.hasOwn(data, spec.key) ? data[spec.key] : undefined;
    return {
      spec,
      pointer: toPointer([...path, spec.key]),
      value: typeof value === 'string' ? value : '',
      editable: value === undefined || typeof value === 'string',
    };
  };
}

function namespaces(data: Record<string, unknown> | undefined): readonly string[] {
  const extensions = data?.extensions;
  return isRecord(extensions) ? Object.keys(extensions) : [];
}

/** The id an item carries, when it's text. */
function idOf(data: unknown): string | null {
  return isRecord(data) && typeof data.id === 'string' && data.id !== '' ? data.id : null;
}

/** The stable item a work at `index` is, as the owner reads it. */
export function workItem(data: unknown, index: number): string {
  const id = idOf(data);
  return id ? `Work ${id}` : `Work ${index + 1}, with no id`;
}

/** The stable item a section at `index` is, as the owner reads it. */
export function sectionItem(data: unknown, index: number): string {
  const id = idOf(data);
  const kind = isRecord(data) && typeof data.kind === 'string' ? data.kind : null;
  const name = id ? `Section ${id}` : `Section ${index + 1}, with no id`;
  return kind ? `${name} (${kind})` : name;
}

/** The objects the fields edit, in the order the document reads, from its plain data. */
export function fieldGroups(data: unknown): readonly FieldGroup[] {
  const root = isRecord(data) ? data : {};
  const groups: FieldGroup[] = [];
  const object = (value: unknown) => (isRecord(value) ? value : undefined);

  groups.push({
    pointer: '',
    item: 'The portfolio document',
    facts: [],
    fields: DOCUMENT_FIELDS.map(bind(root, [])),
    extensions: namespaces(root),
  });
  for (const [key, item, specs] of [
    ['identity', 'Identity', IDENTITY_FIELDS],
    ['meta', 'Page metadata', META_FIELDS],
  ] as const) {
    const value = object(root[key]);
    // An object the document holds as something else is left to source mode.
    if (root[key] !== undefined && !value) continue;
    groups.push({
      pointer: toPointer([key]),
      item,
      facts: [],
      fields: specs.map(bind(value, [key])),
      extensions: namespaces(value),
    });
  }
  const works = Array.isArray(root.works) ? root.works : [];
  works.forEach((work, index) => {
    const value = object(work);
    if (!value) return;
    groups.push({
      pointer: toPointer(['works', index]),
      item: workItem(value, index),
      facts: [
        { label: 'Stable id', value: idOf(value) ?? 'none' },
        ...(typeof value.slug === 'string' ? [{ label: 'Slug', value: value.slug }] : []),
      ],
      fields: WORK_FIELDS.map(bind(value, ['works', index])),
      extensions: namespaces(value),
    });
  });
  const sections = Array.isArray(root.sections) ? root.sections : [];
  sections.forEach((section, index) => {
    const value = object(section);
    if (!value) return;
    const kind = typeof value.kind === 'string' ? value.kind : '';
    const specs: FieldSpec[] = [
      // A custom section's title is what shows, so it's required there.
      text('title', 'Title', kind === 'custom'),
      text('subtitle', 'Subtitle'),
      ...(SECTION_FIELDS[kind] ?? []),
    ];
    groups.push({
      pointer: toPointer(['sections', index]),
      item: sectionItem(value, index),
      facts: [
        { label: 'Stable id', value: idOf(value) ?? 'none' },
        { label: 'Kind', value: kind || 'none' },
      ],
      fields: specs.map(bind(value, ['sections', index])),
      extensions: namespaces(value),
    });
  });
  return groups;
}

export type ReadDocument =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly problem: { readonly message: string; readonly line?: number };
    };

/** A document's text as plain data, never through the schemas, or why it doesn't read. */
export function readDocument(document: SourceDocument): ReadDocument {
  const parsed = parseSource(document.sourceText, document.format);
  if (parsed.ok) return { ok: true, data: parsed.data };
  const [first] = parsed.problems;
  return {
    ok: false,
    problem: {
      message: first?.message ?? "The document doesn't read.",
      ...(first?.line === undefined ? {} : { line: first.line }),
    },
  };
}

export type FieldEdit =
  | { readonly ok: true; readonly sourceText: string }
  | { readonly ok: false; readonly message: string };

/**
 * The document's text with one field set to `value` through #4's
 * applyEdits: emptied, an optional field is left out and a required one
 * kept blank. A JSON document keeps its own indent. Nothing else in the
 * text changes, as far as #4 allows.
 */
export function editField(document: SourceDocument, field: BoundField, value: string): FieldEdit {
  if (!field.editable) {
    return { ok: false, message: "This field holds a value fields can't edit. Use source mode." };
  }
  if (value === field.value) return { ok: true, sourceText: document.sourceText };
  const leaveOut = value === '' && !field.spec.required;
  try {
    const sourceText = applyEdits(
      document.sourceText,
      document.format,
      [
        leaveOut
          ? { pointer: field.pointer, op: 'delete' }
          : { pointer: field.pointer, op: 'set', value },
      ],
      document.format === 'json' ? { indent: jsonIndent(document.sourceText) } : {},
    );
    return { ok: true, sourceText };
  } catch {
    return {
      ok: false,
      message: "This change couldn't be made here. Make it in source mode.",
    };
  }
}

/** The value at a pointer in plain data, or undefined when the data has none there. */
export function valueAt(data: unknown, pointer: string): unknown {
  if (pointer === '') return data;
  let node = data;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(node)) node = node[Number(key)];
    else if (isRecord(node) && Object.hasOwn(node, key)) node = node[key];
    else return undefined;
  }
  return node;
}
