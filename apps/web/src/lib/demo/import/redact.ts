import {
  allowedKeysAt,
  DEFAULT_SCHEMAS,
  DIAGNOSTIC_REMEDIATIONS,
  parsePointer,
  toPointer,
  type Diagnostic,
} from '@portfolio/schema';

// What the import's diagnostics may say about a file (#9, PR 3). #4's
// diagnostics never repeat a value, but their pointers, messages, and
// stableId name the document's keys, and a key is text from the file: a
// section id under site.sections, an unknown field, an extension namespace,
// or `<img src=x onerror=alert(1)>`. This fails closed. Every key the schema
// doesn't name at its place becomes UNKNOWN_KEY, in the pointer, in the
// message and remediation, and as the stableId. Keys the schema names stay,
// so a caller can still point at the field. An array index stays where the
// data has an array. Where there's no data to look in, as for a file that
// didn't parse, a key stays when it's a word the schemas name anywhere,
// since a union's member can't be told without the value, and an index
// stays as one.

/** What stands in for a key the schema doesn't name. */
export const UNKNOWN_KEY = '(unknown key)';

const SCHEMAS = {
  portfolio: DEFAULT_SCHEMAS.PortfolioSchema,
  site: DEFAULT_SCHEMAS.SiteSchema,
} as const;

const INDEX = /^(?:0|[1-9]\d*)$/;

/** Each document's data, or undefined for one that didn't parse. */
export type DocumentData = { readonly portfolio?: unknown; readonly site?: unknown };

/** A diagnostic with every key the schema doesn't name replaced by UNKNOWN_KEY. */
export function redactDiagnostic(diagnostic: Diagnostic, data: DocumentData): Diagnostic {
  const segments = parsePointer(diagnostic.pointer);
  const document =
    diagnostic.document === 'portfolio' || diagnostic.document === 'site'
      ? diagnostic.document
      : undefined;
  const raw: string[] = [];
  let pointer: string;
  if (segments === null) {
    // Not a pointer this can read: say nothing of it.
    pointer = UNKNOWN_KEY;
    raw.push(diagnostic.pointer);
  } else {
    const root = document ? data[document] : undefined;
    const kept = segments.map((segment, index) => {
      if (document && named(document, root, segments.slice(0, index), segment)) return segment;
      raw.push(segment);
      return UNKNOWN_KEY;
    });
    pointer = toPointer(kept);
  }
  if (raw.length === 0) return diagnostic;

  const echoes = (text: string) =>
    raw.some((key) => key !== '' && (text.includes(key) || text.includes(escaped(key))));
  let message = diagnostic.message.split(diagnostic.pointer).join(pointer);
  if (echoes(message)) {
    message = `There's a ${diagnostic.code} finding at ${pointer}.`;
  }
  const remediation = echoes(diagnostic.remediation)
    ? (DIAGNOSTIC_REMEDIATIONS[diagnostic.code as keyof typeof DIAGNOSTIC_REMEDIATIONS] ??
      'Fix the document at this position.')
    : diagnostic.remediation;
  const { stableId, ...rest } = diagnostic;
  return {
    ...rest,
    pointer,
    message,
    remediation,
    ...(stableId === undefined ? {} : { stableId: echoes(stableId) ? UNKNOWN_KEY : stableId }),
  };
}

/**
 * Whether `segment` is a key the schema names on the object at `path`, or an
 * index into an array there. With no data, an index, or any word the
 * schemas name.
 */
function named(
  document: 'portfolio' | 'site',
  root: unknown,
  path: readonly string[],
  segment: string,
): boolean {
  // With no data, a union's member can't be told from its value, so any word
  // the schemas name stays. Each is the schema's own text, never the file's.
  if (root === undefined) return INDEX.test(segment) || schemaWords().has(segment);
  const parent = valueAt(root, path);
  if (Array.isArray(parent)) return INDEX.test(segment);
  return (allowedKeysAt(SCHEMAS[document], root, path) ?? []).includes(segment);
}

/** A zod schema as far as this reads it: its definition's type name and children. */
type SchemaNode = { readonly _def: Record<string, unknown> } & Record<string, unknown>;

let words: ReadonlySet<string> | undefined;

/**
 * Every key any object in the portfolio, site, and core section schemas
 * names, at any depth: the words a pointer may keep when there's no data
 * to find its place in.
 */
export function schemaWords(): ReadonlySet<string> {
  if (words) return words;
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const pending: unknown[] = [
    DEFAULT_SCHEMAS.PortfolioSchema,
    DEFAULT_SCHEMAS.SiteSchema,
    ...DEFAULT_SCHEMAS.coreSections,
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next !== 'object' || next === null || seen.has(next) || !('_def' in next)) continue;
    seen.add(next);
    const node = next as SchemaNode;
    const def = node._def;
    switch (def.typeName) {
      case 'ZodObject': {
        const shape = (node as unknown as { shape: Record<string, unknown> }).shape;
        for (const [key, child] of Object.entries(shape)) {
          found.add(key);
          pending.push(child);
        }
        break;
      }
      case 'ZodArray':
        pending.push(def.type);
        break;
      case 'ZodRecord':
        pending.push(def.valueType);
        break;
      case 'ZodOptional':
      case 'ZodNullable':
      case 'ZodDefault':
        pending.push(def.innerType);
        break;
      case 'ZodEffects':
        pending.push(def.schema);
        break;
      case 'ZodPipeline':
        pending.push(def.in, def.out);
        break;
      case 'ZodUnion':
      case 'ZodDiscriminatedUnion':
        pending.push(...(def.options as unknown[]));
        break;
      default:
        break;
    }
  }
  words = found;
  return words;
}

function valueAt(root: unknown, path: readonly string[]): unknown {
  let value = root;
  for (const segment of path) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, segment)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function escaped(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}
