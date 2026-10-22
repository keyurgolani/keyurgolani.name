// The react-dom/server half of render parity (#5, Slice 6): what the host
// renders inside its presentation boundary, rendered outside Next, after the
// host's own server module registers the extension renderers. bundles.ts
// builds it for Node; `@host` is the apps/web/src/lib of the build under
// test.
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { resolvePortfolioView } from '@portfolio/schema';
import { readPair, readUnitFiles } from '@portfolio/schema/node';
import { buildRenderInput, type RenderInputArgs } from '@portfolio/variant-contract';
import '@host/host-modules';
import { CONTENT_EXTENSIONS } from '@host/generated/registry.extensions';
import { VARIANT_LOADERS } from '@host/generated/registry.loaders';
import { VARIANTS } from '@host/generated/registry.meta';
import { createAppearanceCatalog } from '@host-server/appearance-catalog';

/** Where the host serves the published view's renditions: server/public-view.ts's MEDIA_BASE. */
const MEDIA_BASE = '/media';

/**
 * What the host passes buildRenderInput() for the home page of the pair in
 * `files`, with the snapshots and media document beside it (#10), rendered
 * by the registered variant `id` from `origin` at `requestTime`. It's plain
 * JSON, so the browser half takes it as it is.
 */
export function renderArgs(
  files: { readonly portfolio: string; readonly site: string },
  id: string,
  origin: string,
  requestTime: string,
): RenderInputArgs {
  const read = readPair(files, { catalog: createAppearanceCatalog() });
  if (!read.ok) throw new Error(`The fixture doesn't load: ${JSON.stringify(read.diagnostics)}`);
  // As the host's catalog reads them: a blocking record would stop its startup.
  const unit = readUnitFiles(path.dirname(files.portfolio));
  if (unit.diagnostics.some(({ severity }) => severity !== 'warning')) {
    throw new Error(`The fixture's unit files don't read: ${JSON.stringify(unit.diagnostics)}`);
  }
  const registered = VARIANTS.find(({ manifest }) => manifest.id === id);
  if (!registered) throw new Error(`The build registers no variant ${id}.`);
  return {
    view: resolvePortfolioView(
      read.pair,
      { media: unit.media, snapshots: unit.snapshots },
      { mediaBase: MEDIA_BASE, extensions: CONTENT_EXTENSIONS },
    ),
    manifest: registered.manifest,
    route: { route: 'home' },
    basePath: '',
    origin,
    requestTime,
  };
}

/** The boundary, `<div data-variant>`, with the variant inside, as HTML. */
export async function renderBoundary(args: RenderInputArgs): Promise<string> {
  const input = buildRenderInput(args);
  const load = VARIANT_LOADERS[args.manifest.id];
  if (!load) throw new Error(`The build has no loader for ${args.manifest.id}.`);
  const { default: Variant } = await load();
  return renderToString(
    <div data-variant={args.manifest.id}>
      <Variant input={input} />
    </div>,
  );
}
