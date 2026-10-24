'use client';

import { useEffect, useState } from 'react';
import type { DemoBackend } from '~/lib/demo/browser-backend';
import { browserStorage, demoStore } from '~/lib/demo/storage';
import { loadSelection, type DemoSelection, type SchemeModes } from '~/lib/demo/url-state';
import type { AppearanceCatalog } from '~/lib/studio/appearance';
import type { StudioPolicy } from '~/lib/studio/backend';
import type { StudioDraft } from '~/lib/studio/documents';
import { loadBackend } from '~/lib/studio/load-backend';
import { DemoStudio } from './demo/demo-studio';

// Demo Studio's page shell (#9): it loads the browser backend's chunk, the
// demo's alone, through load-backend.ts, over the visitor's own storage,
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
  };
}

export function DemoShell({ policy, setup }: DemoShellProps) {
  const { catalog, schemeModes, unit, defaults } = setup;
  const [backend, setBackend] = useState<DemoBackend | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBackend('demo').then(
      ({ browserBackend, storedSelection }) => {
        if (cancelled) return;
        const rules = { catalog, schemeModes };
        const store = demoStore(browserStorage('local'), browserStorage('session'));
        const { selection } = loadSelection({
          search: new URLSearchParams(window.location.search),
          stored: storedSelection(store, defaults, rules),
          defaults,
          rules,
        });
        setBackend(
          browserBackend({ unit, catalog, schemeModes, defaults, store, initial: selection }),
        );
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [catalog, schemeModes, unit, defaults]);

  return (
    <DemoStudio
      catalog={catalog}
      schemeModes={schemeModes}
      policy={policy}
      backend={backend}
      failed={failed && backend === null}
    />
  );
}
