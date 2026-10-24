'use client';

import { useEffect, useState } from 'react';
import type { DemoBackend } from '~/lib/demo/browser-backend';
import { browserStorage, demoStore } from '~/lib/demo/storage';
import {
  loadSelection,
  sourceFrom,
  type DemoSelection,
  type DemoSource,
  type SchemeModes,
} from '~/lib/demo/url-state';
import type { AppearanceCatalog } from '~/lib/studio/appearance';
import type { StudioPolicy } from '~/lib/studio/backend';
import type { StudioDraft } from '~/lib/studio/documents';
import { DemoStudio } from './demo-studio';

// Demo Studio's page shell (#9): it loads the browser backend's chunk, the
// demo's alone, with an import() of its own, so nothing it loads names Owner
// Studio's adapter, over the visitor's own storage,
// with the selection the URL or this browser holds, and hands it to
// DemoStudio. Until the chunk arrives the demo says it's loading; if it
// never does, it says so.

export interface DemoShellProps {
  readonly policy: StudioPolicy;
  readonly setup: {
    readonly catalog: AppearanceCatalog;
    readonly schemeModes: SchemeModes;
    readonly unit: { readonly revisionId: string; readonly documents: StudioDraft['documents'] };
    readonly defaults: DemoSelection;
    /** The read-only reference startup verified (#9), or null: then nothing of one is offered. */
    readonly reference: { readonly name: string; readonly defaults: DemoSelection } | null;
  };
}

export function DemoShell({ policy, setup }: DemoShellProps) {
  const { catalog, schemeModes, unit, defaults, reference } = setup;
  const [backend, setBackend] = useState<DemoBackend | null>(null);
  const [source, setSource] = useState<DemoSource>('sample');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('~/lib/demo/browser-backend').then(
      ({ browserBackend, storedSelection }) => {
        if (cancelled) return;
        const rules = { catalog, schemeModes };
        const store = demoStore(browserStorage('local'), browserStorage('session'));
        const search = new URLSearchParams(window.location.search);
        // The reference only when the page has one: any other source is the sample.
        const shown = sourceFrom(search, reference !== null);
        const base = shown === 'reference' && reference ? reference.defaults : defaults;
        const { selection } = loadSelection({
          search,
          stored: storedSelection(store, defaults, rules),
          defaults: base,
          rules,
        });
        const loaded = browserBackend({
          unit,
          catalog,
          schemeModes,
          defaults,
          store,
          initial: selection,
        });
        if (shown === 'reference' && reference) loaded.showSource(reference.defaults, selection);
        setSource(shown);
        setBackend(loaded);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [catalog, schemeModes, unit, defaults, reference]);

  return (
    <DemoStudio
      catalog={catalog}
      schemeModes={schemeModes}
      policy={policy}
      backend={backend}
      reference={reference ? { name: reference.name, defaults: reference.defaults } : null}
      initialSource={source}
      failed={failed && backend === null}
    />
  );
}
