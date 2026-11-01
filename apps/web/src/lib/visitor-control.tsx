'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { VisitorAppearanceModel } from '@portfolio/appearance';
import { VisitorAppearance } from '@portfolio/appearance/react';
import { SingleKeyShortcutsControl } from '@portfolio/kit/runtime';
import { useControlInMenu } from './menu-control';

// The visitor's appearance control in every variant's VisitorControlSlot
// (#19, Slice 4). The kit can't import the host, so lib/host-modules.ts
// registers SiteVisitorControl as what fills the slot, and the document
// boundary of a visitor page hands it the page's model and path through
// VisitorControlProvider. A page with none, such as a preview, which reads
// no visitor value, leaves the slot empty. Once the page hydrates, a choice
// saves through POST /api/appearance and the page renders again with Next's
// router.refresh(); before that, and without JavaScript, the control is a
// form that posts there and comes back.
//
// Where the variant's document binding holds `/`, a single-character key, the
// control shows the kit's Single-key shortcuts toggle after it (K-4 (d), WCAG
// 2.1.4), on a page with no appearance choice to offer too: the host's, so
// every variant gets the same one.

/** What the slot's control shows: visitorAppearanceModel()'s answer, and the page to come back to. */
export interface VisitorControlValue {
  readonly model: VisitorAppearanceModel;
  /** The page's path and query, as the visitor asked for it. */
  readonly returnTo: string;
  /** The control's language, when the portfolio's isn't English. */
  readonly lang?: string;
  /** Whether the variant's document binding holds `/`, which the visitor can turn off. */
  readonly singleKeyShortcuts?: boolean;
}

const VisitorControlContext = createContext<VisitorControlValue | null>(null);

/** What a visitor page's document boundary wraps the variant in. */
export function VisitorControlProvider({
  value,
  children,
}: {
  readonly value: VisitorControlValue;
  readonly children: ReactNode;
}) {
  return <VisitorControlContext value={value}>{children}</VisitorControlContext>;
}

/**
 * The slot's content: the control, or nothing outside a visitor page. While
 * a narrow screen's Menu holds the control (lib/menu-control.ts), the slot
 * renders nothing and the Menu renders it, `inMenu`, so it's never on the
 * page twice.
 */
export function SiteVisitorControl({ inMenu = false }: { readonly inMenu?: boolean } = {}) {
  const value = useContext(VisitorControlContext);
  const moved = useControlInMenu();
  if (!value) return null;
  const appearance = value.model.controls.length > 0;
  if (!appearance && !value.singleKeyShortcuts) return null;
  if (moved && !inMenu) return null;
  return (
    <>
      {appearance ? <LiveControl value={value} /> : null}
      {value.singleKeyShortcuts ? (
        <SingleKeyShortcutsControl {...(value.lang ? { lang: value.lang } : {})} />
      ) : null}
    </>
  );
}

/** The control with Next's refresh, inside a page Next's router mounted. */
function LiveControl({ value }: { readonly value: VisitorControlValue }) {
  const router = useRouter();
  return (
    <VisitorAppearance
      model={value.model}
      returnTo={value.returnTo}
      refresh={() => router.refresh()}
      {...(value.lang ? { lang: value.lang } : {})}
    />
  );
}
