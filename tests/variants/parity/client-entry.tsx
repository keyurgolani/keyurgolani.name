// The createRoot half of render parity (#5, Slice 6): a variant's .
// export rendered in a browser, in a test page parity.spec.ts loads with
// page.setContent(), from the input buildRenderInput() builds there, after
// the host's own client module registers its maps. bundles.ts builds it for
// the browser; `@host` is the apps/web/src/lib of the build under test.
import { useLayoutEffect, type ReactNode } from 'react';
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

/**
 * Hands `commit` the boundary's snapshot at the render's first commit. Its
 * layout effect runs in that commit, after the boundary's DOM is in place
 * and before any passive effect: React 19 runs a sync render's passive
 * effects before flushSync() returns, so a snapshot read after it already
 * holds what a mount effect added, such as an enhancement that shows its
 * controls once it has hydrated, which the server never renders.
 */
function FirstCommit(props: {
  readonly commit: (snapshot: ParityNode | null) => void;
  readonly children: ReactNode;
}) {
  const { commit } = props;
  useLayoutEffect(() => commit(snapshotBoundary(document)), [commit]);
  return props.children;
}

window.renderBoundary = async (args) => {
  const input = buildRenderInput(args);
  const load = VARIANT_LOADERS[args.manifest.id];
  if (!load) throw new Error(`The build has no loader for ${args.manifest.id}.`);
  const { default: Variant } = await load();
  return new Promise<ParityNode | null>((resolve, reject) => {
    let first: { snapshot: ParityNode | null } | undefined;
    const commit = (snapshot: ParityNode | null) => {
      // The render's own commit, read before anything after it runs: an
      // enhancement renders nothing on the server, and loads after this, so
      // what it adds later is no part of the render.
      if (first) return;
      first = { snapshot };
      resolve(snapshot);
    };
    const root = createRoot(document.getElementById('root')!, {
      // A render that throws commits nothing, so the promise says why.
      onUncaughtError: (error) => reject(error instanceof Error ? error : new Error(String(error))),
    });
    root.render(
      <FirstCommit commit={commit}>
        <div data-variant={args.manifest.id}>
          <Variant input={input} />
        </div>
      </FirstCommit>,
    );
  });
};
