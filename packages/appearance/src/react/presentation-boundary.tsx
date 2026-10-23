import type { ReactNode } from 'react';
import {
  boundaryAttributes,
  stylesheetHrefs,
  type AppearanceStylesheets,
  type BoundaryAppearance,
  type BoundaryKind,
} from '../boundary';
import type { AppearanceDiagnostic } from '../diagnostics';
import type { BoundaryIds } from '../ids';
import { SkipLink } from '../primitives/skip-link';
import { BoundaryRoot } from './boundary-root';

// PresentationBoundary (#19, Slice 3, item 1): the root-scoped boundary one
// resolved appearance renders in. Server code renders it; it hands its
// client half plain data. Its stylesheets go out as React 19 stylesheet
// resources, which React hoists into the head, links once however many
// boundaries share one, and waits for before showing what needs them. Each
// starts with the layer order, so the order they load in changes nothing.
//
// `document` is the page's one boundary: unprefixed ids, so fragment URLs
// stay stable, and the skip link to the variant's main. `plate` previews
// another selection inside a page: inert, contained, still, enhancements
// off, ids prefixed, no skip link, and landmarks as plain elements.

export interface PresentationBoundaryProps {
  readonly kind: BoundaryKind;
  /** resolveAppearance()'s result for this boundary. */
  readonly appearance: BoundaryAppearance;
  /** The render input's ids: unprefixed for a document, the plate's own prefix for a plate. */
  readonly ids: BoundaryIds;
  /** Where the platform's and the packs' stylesheets are. Without it, the boundary links none. */
  readonly stylesheets?: AppearanceStylesheets;
  /** A document boundary's skip link: its label, and its language when the portfolio's isn't the label's. */
  readonly skipLink?: { readonly label?: string; readonly lang?: string };
  /** The nonce of the request's Content-Security-Policy, where its policy wants one on every stylesheet, as a preview frame's does. */
  readonly nonce?: string;
  readonly children?: ReactNode;
}

export function PresentationBoundary({
  kind,
  appearance,
  ids,
  stylesheets,
  skipLink,
  nonce,
  children,
}: PresentationBoundaryProps) {
  if (kind === 'document' && ids.prefix !== '') {
    throw new Error(
      `A document boundary renders unprefixed ids, so fragment URLs stay stable, and this one's start with ${ids.prefix}.`,
    );
  }
  if (kind === 'plate' && ids.prefix === '') {
    throw new Error(
      "A plate's ids need their own prefix, such as pl-1-, so they can't take the page's.",
    );
  }
  const hrefs = stylesheets ? stylesheetHrefs(appearance.selection, stylesheets) : [];
  return (
    <>
      {hrefs.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="appearance" nonce={nonce} />
      ))}
      <BoundaryRoot kind={kind} ids={ids} attributes={boundaryAttributes(appearance, kind)}>
        {kind === 'document' ? <SkipLink target={ids.main} {...skipLink} /> : null}
        {children}
      </BoundaryRoot>
    </>
  );
}

export interface AppearanceDiagnosticsProps {
  /** resolveAppearance()'s diagnostics. */
  readonly diagnostics: readonly AppearanceDiagnostic[];
  /** The list's accessible name. */
  readonly label?: string;
  readonly id?: string;
}

/**
 * The resolver's diagnostics as the owner reads them, each with its code,
 * what happened, and what to do, for an owner's surface such as Studio or
 * the fixture page to place beside a boundary. Visitors never get it; the
 * boundary itself only carries the codes, in data-appearance-diagnostics.
 */
export function AppearanceDiagnostics({
  diagnostics,
  label = 'Appearance diagnostics',
  id,
}: AppearanceDiagnosticsProps) {
  if (diagnostics.length === 0) return null;
  return (
    <section id={id} data-appearance-diagnostics-list="" aria-label={label}>
      <ul>
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.code}#${index}`} data-code={diagnostic.code}>
            <code>{diagnostic.code}</code> {diagnostic.message} {diagnostic.remediation}
          </li>
        ))}
      </ul>
    </section>
  );
}
