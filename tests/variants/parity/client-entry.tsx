// The createRoot half of render parity (#5, Slice 6): a variant's .
// export rendered in a browser, in a test page parity.spec.ts loads with
// page.setContent(), from the input buildRenderInput() builds there, after
// the host's own client module registers its maps. bundles.ts builds it for
// the browser; `@host` is the apps/web/src/lib of the build under test.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { buildRenderInput, type RenderInputArgs } from '@portfolio/variant-contract';
import {
  snapshotBoundary,
  type ParityNode,
} from '../../../packages/variant-contract/src/node/parity';
import '@host/host-modules-client';
import { VARIANT_LOADERS } from '@host/generated/registry.loaders';

declare global {
  interface Window {
    /** Renders the boundary, with the variant inside, into #root, and returns its first commit's snapshot. */
    renderBoundary(args: RenderInputArgs): Promise<ParityNode | null>;
  }
}

window.renderBoundary = async (args) => {
  const input = buildRenderInput(args);
  const load = VARIANT_LOADERS[args.manifest.id];
  if (!load) throw new Error(`The build has no loader for ${args.manifest.id}.`);
  const { default: Variant } = await load();
  const root = createRoot(document.getElementById('root')!);
  flushSync(() =>
    root.render(
      <div data-variant={args.manifest.id}>
        <Variant input={input} />
      </div>,
    ),
  );
  // The render's own commit, read before anything after it runs: an
  // enhancement renders nothing on the server, and loads after this, so what
  // it adds later is no part of the render.
  return snapshotBoundary(document);
};
