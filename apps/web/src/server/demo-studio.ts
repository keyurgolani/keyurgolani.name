import 'server-only';
import { findPack, type AppearanceRegistry } from '@portfolio/appearance';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { AXES, type AppearanceCatalog, type CatalogAxis } from '~/lib/studio/appearance';
import type { DraftDocument, StudioDraft } from '~/lib/studio/documents';
import { getLive } from './catalog';
import { appearanceCatalog } from './studio-appearance';

// What Demo Studio's page hands its shell (#9): the build's appearance
// catalog without generated color schemes, which /sample can't render; the
// modes each scheme has; and the bundled sample, the same public documents
// /sample renders, with its site's own selection as the demo's default.
// Plain data. Nothing here is the owner's, and it imports no demo code.

export interface DemoStudioSetup {
  readonly catalog: AppearanceCatalog;
  readonly schemeModes: Readonly<Record<string, readonly string[]>>;
  readonly unit: { readonly revisionId: string; readonly documents: StudioDraft['documents'] };
  readonly defaults: Readonly<Record<CatalogAxis, string>>;
}

/** A parsed document as Studio reads one: its model, and its text as JSON. */
function asDocument(model: unknown): DraftDocument {
  return { format: 'json', sourceText: `${JSON.stringify(model, null, 2)}\n`, diagnostics: [], model };
}

export async function demoStudioSetup(
  registry: AppearanceRegistry = APPEARANCE_REGISTRY,
): Promise<DemoStudioSetup> {
  const full = appearanceCatalog(registry);
  const catalog: AppearanceCatalog = {
    axes: full.axes.map((entry) =>
      entry.axis === 'colorScheme'
        ? {
            ...entry,
            options: entry.options.filter(
              ({ id }) => !findPack(registry, 'colorScheme', id)?.manifest.generator,
            ),
          }
        : entry,
    ),
  };
  const schemeModes = Object.fromEntries(
    (catalog.axes.find(({ axis }) => axis === 'colorScheme')?.options ?? []).flatMap(({ id }) => {
      const entry = findPack(registry, 'colorScheme', id);
      return entry && 'modes' in entry ? [[id, [...(entry.modes as readonly string[])]]] : [];
    }),
  );
  const live = await getLive();
  const site = live.unit?.site as { appearance?: Record<string, unknown> } | undefined;
  const appearance = site?.appearance ?? {};
  const defaults = Object.fromEntries(
    AXES.map((axis) => {
      const value = appearance[axis];
      const fallback = full.axes.find((entry) => entry.axis === axis)?.fallback ?? '';
      return [axis, typeof value === 'string' ? value : fallback];
    }),
  ) as Record<CatalogAxis, string>;
  return {
    catalog,
    schemeModes,
    unit: {
      revisionId: live.revisionId ?? 'sample',
      documents: {
        portfolio: asDocument(live.unit?.portfolio ?? null),
        site: asDocument(live.unit?.site ?? null),
      },
    },
    defaults,
  };
}
