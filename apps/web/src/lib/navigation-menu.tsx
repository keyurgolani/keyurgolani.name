'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Dialog } from '@portfolio/appearance/primitives';
import { useBoundary } from '@portfolio/appearance/react';
import type { HostNavigationMenuProps } from '@portfolio/kit/host-modules';
import { claimControl, useControlInMenu, useMedia } from './menu-control';

// The host's Menu in every composition's NavigationMenuSlot (stream A,
// global rule 7). The kit can't import the host, so lib/host-modules.ts and
// lib/host-modules-client.tsx register SiteNavigationMenu as what fills the
// slot, and a composition stays a server module. It's #19's Dialog:
// - its header holds the title and the close button, in view while the
//   composition's links scroll under it;
// - a tap on the backdrop closes it (lightDismiss), as Escape does;
// - following a link to a place on the page closes it and puts focus there
//   (closeOnNavigate).
// When the composition asks, the visitor's appearance control, which the
// slot hands it as `control`, moves in at the end while its media query
// matches (lib/menu-control.ts). Until its script runs, and where scripts
// don't, the stylesheet (experience-base.css) shows the slot's plain link to
// the composition's index in place of the button.

const noChange = () => () => {};
const scriptRuns = () => true;
const scriptDoesNotRun = () => false;

export function SiteNavigationMenu({
  id,
  label,
  lang,
  href,
  children,
  visitorControl,
  control,
}: HostNavigationMenuProps) {
  const { plate } = useBoundary();
  const narrow = useMedia(plate || !control ? undefined : visitorControl?.media);
  useEffect(() => (narrow ? claimControl() : undefined), [narrow]);
  const holdsControl = useControlInMenu() && narrow;
  // False in the server's HTML, true once this script runs: the stylesheet
  // shows the button only then.
  const scripted = useSyncExternalStore(noChange, scriptRuns, scriptDoesNotRun);
  return (
    <span data-navigation-menu="" data-navigation-menu-scripted={scripted ? '' : undefined}>
      <Dialog
        id={id}
        trigger={<span lang={lang}>{label}</span>}
        title={<span lang={lang}>{label}</span>}
        closeOnNavigate
        lightDismiss
        closeInHeader
      >
        {children}
        {holdsControl ? <div data-navigation-menu-control="">{control}</div> : null}
      </Dialog>
      <a href={href} lang={lang} data-navigation-menu-link="">
        {label}
      </a>
    </span>
  );
}
