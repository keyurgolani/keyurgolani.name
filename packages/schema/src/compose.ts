import { z } from 'zod';
import {
  createExtensionRegistry,
  ExtensionDataSchema,
  type ContentExtension,
  type ExtensionRegistry,
} from './extensions';
import { parseExtensionKind } from './ids';
import { addNestedIssue } from './issues';
import { isPlainObject } from './json';
import {
  coreSectionSchemas,
  makeParts,
  sectionBase,
  type Section,
  type SchemaParts,
} from './kinds';
import { portfolioSchemas } from './portfolio';
import { siteSchemas } from './site';

// Builds both documents' schemas for a set of content extensions. Every
// validator parses with a composed schema: the defaults below register none.

/** Where the section router keeps its kind lookup, for hint resolution. */
export const SECTION_ROUTE: unique symbol = Symbol('portfolio.sectionRoute');
/** Marks an extension section's `data` schema, for hint resolution. */
export const EXTENSION_DATA: unique symbol = Symbol('portfolio.extensionData');

export type SectionRouter = z.ZodType<Section, z.ZodTypeDef, unknown> & {
  readonly [SECTION_ROUTE]: (kind: unknown) => z.ZodTypeAny | undefined;
};

export function composeSchemas(extensions: readonly ContentExtension[] = []) {
  const registry = createExtensionRegistry(extensions);
  const parts = makeParts(registry);
  const core = coreSectionSchemas(parts);
  const SectionSchema = sectionRouter(parts, core.sections, registry);
  return {
    registry,
    parts,
    SectionSchema,
    coreSections: core.sections,
    ...portfolioSchemas(parts, SectionSchema),
    ...siteSchemas(parts),
  };
}

export type ComposedSchemas = ReturnType<typeof composeSchemas>;

/**
 * Routes each section by `kind`: a core kind to its schema, a registered
 * extension kind to its `data` schema, and any other `<package>/<name>` kind
 * to plain JSON `data`, kept as written. Any other kind is refused.
 */
export function sectionRouter(
  parts: SchemaParts,
  core: readonly z.AnyZodObject[],
  registry: ExtensionRegistry,
): SectionRouter {
  // `data` is checked as plain JSON first, then against the extension's schema.
  // Each pipeline is a fresh schema, so marking it changes nothing shared.
  const extensionSection = (kind: z.ZodTypeAny, data: z.ZodTypeAny) =>
    parts.object({
      kind,
      ...sectionBase,
      data: Object.assign(ExtensionDataSchema.pipe(data), { [EXTENSION_DATA]: true }),
    });
  const table = new Map<string, z.ZodTypeAny>();
  for (const schema of core) table.set((schema.shape.kind as z.ZodLiteral<string>).value, schema);
  for (const [kind, data] of registry.sectionKinds) {
    table.set(kind, extensionSection(z.literal(kind), data));
  }
  const unregistered = extensionSection(z.string(), z.unknown());
  const known = [...table.keys()];

  const route = (kind: unknown): z.ZodTypeAny | undefined => {
    if (typeof kind !== 'string') return undefined;
    const schema = table.get(kind);
    if (schema) return schema;
    // A registered extension declares every kind it adds, so an unknown name
    // under its namespace is a mistake, not data to keep.
    const extension = parseExtensionKind(kind);
    return extension && !registry.extension(extension.namespace) ? unregistered : undefined;
  };

  const schema = z.unknown().transform((value, ctx): Section => {
    if (!isPlainObject(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.invalid_type,
        expected: 'object',
        received: typeName(value),
      } as z.IssueData);
      return z.NEVER;
    }
    if (typeof value.kind !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.invalid_type,
        expected: 'string',
        received: value.kind === undefined ? 'undefined' : typeName(value.kind),
        path: ['kind'],
      } as z.IssueData);
      return z.NEVER;
    }
    const target = route(value.kind);
    if (!target) {
      ctx.addIssue({
        code: z.ZodIssueCode.invalid_union_discriminator,
        options: known,
        path: ['kind'],
      });
      return z.NEVER;
    }
    const result = target.safeParse(value);
    if (result.success) return result.data as Section;
    for (const issue of result.error.issues) addNestedIssue(ctx, issue);
    return z.NEVER;
  });
  return Object.assign(schema, { [SECTION_ROUTE]: route });
}

/** The type name zod would report for a value. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const DEFAULTS = composeSchemas();

/** The schemas with no content extension registered. */
export const DEFAULT_SCHEMAS: ComposedSchemas = DEFAULTS;

export const {
  PortfolioSchema,
  IdentitySchema,
  MetaSchema,
  SectionSchema,
  WorkSchema,
  CaseStudySchema,
  EvidenceSchema,
  ChronologyEntrySchema,
  MediaAssetSchema,
  PracticeSchema,
  ContactSchema,
  SiteSchema,
  AppearanceSelectionSchema,
  VisitorControlsSchema,
  AppearanceInputSchema,
  SiteFeaturesSchema,
} = DEFAULTS;
export const {
  Link: LinkSchema,
  Action: ActionSchema,
  Placement: PlacementSchema,
  FocalPoint: FocalPointSchema,
  Period: PeriodSchema,
} = DEFAULTS.parts;
