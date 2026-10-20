import { z } from 'zod';
import { EXTENSION_SECTION_NAME_PATTERN, isPackageName, parseExtensionKind } from './ids';
import {
  EXTENSION_MAX_BYTES,
  EXTENSION_MAX_DEPTH,
  isPlainObject,
  jsonByteLength,
  plainJsonProblem,
} from './json';

// Content extensions: packages that add namespaced fields to any object and
// their own section kinds, without editing the host. A document may carry
// extension data no build registers; it's kept as written, checked only as
// plain JSON within the limits, reported as a warning, and never rendered.

export interface ContentExtensionSpec {
  /** The extension's npm package name, such as `@acme/portfolio-photography`. */
  readonly namespace: string;
  /**
   * The `data` schema of each section kind the extension adds, by name:
   * `exhibitions` is the kind `<namespace>/exhibitions`.
   */
  readonly sections?: Readonly<Record<string, z.ZodTypeAny>>;
  /** The schema of this namespace's entry in any object's `extensions`. */
  readonly fields?: z.ZodTypeAny;
}

/** Checks and freezes a content extension's definition. Throws when it's malformed. */
export function defineContentExtension<const T extends ContentExtensionSpec>(spec: T): Readonly<T> {
  if (!isPackageName(spec.namespace)) {
    throw new Error(`The content extension namespace isn't an npm package name.`);
  }
  for (const name of Object.keys(spec.sections ?? {})) {
    if (!EXTENSION_SECTION_NAME_PATTERN.test(name)) {
      throw new Error(
        `${spec.namespace}: section names are lowercase words joined by hyphens, such as exhibitions.`,
      );
    }
  }
  return Object.freeze({ ...spec });
}

export type ContentExtension = ReturnType<typeof defineContentExtension>;

/** The extensions one build of the schemas checks, by namespace. */
export interface ExtensionRegistry {
  readonly namespaces: readonly string[];
  extension(namespace: string): ContentExtension | undefined;
  /** Every extension section kind, `<namespace>/<name>`, with its `data` schema. */
  readonly sectionKinds: ReadonlyMap<string, z.ZodTypeAny>;
}

export function createExtensionRegistry(
  extensions: readonly ContentExtension[],
): ExtensionRegistry {
  const byNamespace = new Map<string, ContentExtension>();
  const sectionKinds = new Map<string, z.ZodTypeAny>();
  for (const extension of extensions) {
    if (byNamespace.has(extension.namespace)) {
      throw new Error(`Two content extensions share the namespace ${extension.namespace}.`);
    }
    byNamespace.set(extension.namespace, extension);
    for (const [name, data] of Object.entries(extension.sections ?? {})) {
      sectionKinds.set(`${extension.namespace}/${name}`, data);
    }
  }
  return {
    namespaces: [...byNamespace.keys()],
    extension: (namespace) => byNamespace.get(namespace),
    sectionKinds,
  };
}

/** Namespaced extension entries, as the schemas parse them. */
export type Extensions = Record<string, unknown>;

const PackageNameSchema = z.string().refine(isPackageName, {
  message: 'must be an npm package name, such as @acme/portfolio-photography.',
});

const TOO_LARGE = `is larger than ${EXTENSION_MAX_BYTES / 1024} KiB as JSON.`;
const TOO_DEEP = `is nested more than ${EXTENSION_MAX_DEPTH} levels deep.`;
const NOT_JSON = "holds a value JSON can't represent, such as .inf or .nan.";

/**
 * An extension section's `data`, required and plain JSON within the limits.
 * A registered extension's own schema checks it after this.
 */
export const ExtensionDataSchema = z.unknown().superRefine((value, ctx) => {
  if (value === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.invalid_type, expected: 'object', received: 'undefined' });
    return;
  }
  const problem = plainJsonProblem(value, EXTENSION_MAX_DEPTH);
  if (problem)
    ctx.addIssue({ code: 'custom', message: problem === 'too-deep' ? TOO_DEEP : NOT_JSON });
  else if (jsonByteLength(value) > EXTENSION_MAX_BYTES)
    ctx.addIssue({ code: 'custom', message: TOO_LARGE });
});

/** Where an `extensions` schema keeps its namespace lookup, for hint resolution. */
export const EXTENSION_FIELDS: unique symbol = Symbol('portfolio.extensionFields');

export type ExtensionsSchema = z.ZodType<Extensions, z.ZodTypeDef, unknown> & {
  /** The `fields` schema of a registered namespace. */
  readonly [EXTENSION_FIELDS]: (namespace: string) => z.ZodTypeAny | undefined;
};

/**
 * The `extensions` field every object accepts: entries keyed by npm package
 * name, each a plain JSON object. A registered namespace's entry must also
 * match the extension's `fields` schema; any other entry is kept as written.
 */
export function makeExtensionsSchema(registry: ExtensionRegistry): ExtensionsSchema {
  const schema = z.record(PackageNameSchema, z.unknown()).transform((entries, ctx) => {
    const parsed: Extensions = {};
    for (const [namespace, entry] of Object.entries(entries)) {
      if (!isPlainObject(entry)) {
        ctx.addIssue({
          code: 'custom',
          path: [namespace],
          message: "must be an object holding the extension's fields.",
        });
        continue;
      }
      const problem = plainJsonProblem(entry, EXTENSION_MAX_DEPTH);
      if (problem) {
        ctx.addIssue({
          code: 'custom',
          path: [namespace],
          message: problem === 'too-deep' ? TOO_DEEP : NOT_JSON,
        });
        continue;
      }
      const extension = registry.extension(namespace);
      if (!extension) {
        parsed[namespace] = entry;
        continue;
      }
      if (!extension.fields) {
        ctx.addIssue({
          code: 'custom',
          path: [namespace],
          message: 'belongs to an extension that declares no fields.',
        });
        continue;
      }
      const result = extension.fields.safeParse(entry);
      if (result.success) parsed[namespace] = result.data;
      else {
        for (const issue of result.error.issues) {
          ctx.addIssue({ ...issue, path: [namespace, ...issue.path] });
        }
      }
    }
    if (jsonByteLength(entries) > EXTENSION_MAX_BYTES) {
      ctx.addIssue({ code: 'custom', message: TOO_LARGE });
    }
    return parsed;
  });
  return Object.assign(schema, {
    [EXTENSION_FIELDS]: (namespace: string) => registry.extension(namespace)?.fields,
  });
}

/** Extension data in a parsed document that no registered extension checks. */
export interface UnregisteredExtensionUse {
  /** Path to the `extensions` entry, or to the extension section. */
  readonly path: readonly (string | number)[];
  readonly namespace: string;
  readonly use: 'fields' | 'section';
}

/**
 * Every `extensions` entry and extension section in a parsed document whose
 * namespace isn't registered. It never looks inside extension data, or inside
 * the site document's `variantControls.<id>.values`, which take any keys.
 */
export function findUnregisteredExtensions(
  document: unknown,
  registry: ExtensionRegistry,
): UnregisteredExtensionUse[] {
  const found: UnregisteredExtensionUse[] = [];
  const walk = (node: unknown, path: readonly (string | number)[]): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...path, index]));
      return;
    }
    if (!isPlainObject(node)) return;
    const kind = typeof node.kind === 'string' ? parseExtensionKind(node.kind) : null;
    if (kind && !registry.extension(kind.namespace)) {
      found.push({ path, namespace: kind.namespace, use: 'section' });
    }
    const control = path.length === 2 && path[0] === 'variantControls';
    for (const [key, child] of Object.entries(node)) {
      if (key === 'extensions' && isPlainObject(child)) {
        for (const namespace of Object.keys(child)) {
          if (!registry.extension(namespace)) {
            found.push({ path: [...path, 'extensions', namespace], namespace, use: 'fields' });
          }
        }
        continue;
      }
      if ((kind && key === 'data') || (control && key === 'values')) continue;
      walk(child, [...path, key]);
    }
  };
  walk(document, []);
  return found;
}
