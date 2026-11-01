'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { DemoShell as DemoShellModule } from './demo/demo-shell';
import type { StudioShell as OwnerShellModule } from './shell/studio-shell';

// /studio's one client entry (#9): it renders the profile's shell, each
// through a client import() of its own, so each is an async chunk of its own
// and the page's entry holds neither. The browser loads the one the page
// renders: Owner Studio's shell, studioFetch, and the journal never load
// under demo, and Demo Studio and lib/demo never load under owner. The
// server renders the shell before it answers, as the page has no Suspense
// boundary, so each response is whole.

const OwnerShell = dynamic(() =>
  import('./shell/studio-shell').then((module) => module.StudioShell),
);
const DemoShell = dynamic(() => import('./demo/demo-shell').then((module) => module.DemoShell));

export type StudioEntryProps =
  | ({ readonly profile: 'owner' } & ComponentProps<typeof OwnerShellModule>)
  | ({ readonly profile: 'demo' } & ComponentProps<typeof DemoShellModule>);

export function StudioEntry(props: StudioEntryProps) {
  if (props.profile === 'demo') {
    return <DemoShell policy={props.policy} setup={props.setup} />;
  }
  return (
    <OwnerShell
      csrfToken={props.csrfToken}
      policy={props.policy}
      appearance={props.appearance}
      preview={props.preview}
    />
  );
}
