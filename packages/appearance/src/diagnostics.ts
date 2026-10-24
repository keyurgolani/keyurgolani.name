// What the appearance checks report (#19, Slice 1, item 6). These codes
// replace #4's appearance.unknown. A malformed id, and an id registered on
// another axis, are schema.invalid; an unregistered variant stays #5's
// variant.unavailable.

import type { AppearanceAxis, DiagnosticSeverity } from '@portfolio/schema';

/**
 * Each code with its severity off the live pair. Startup and loadPair()
 * treat appearance.unavailable as a warning, since the axis's fallback
 * renders; import and publish reject it.
 */
export const APPEARANCE_CODES = {
  /**
   * A well-formed pack id this build doesn't register: a Research record,
   * an excluded pack, which the message gives the reason for (#20), or one
   * nothing installs. Preview shows the axis's fallback.
   */
  'appearance.unavailable': 'blocks-publish',
  /** An explicit light or dark mode the scheme lacks. Preview renders its native mode. */
  'appearance.mode-incompatible': 'blocks-publish',
  /** A generator scheme with no valid appearanceInputs entry, or nothing generated to render. */
  'appearance.input-missing': 'blocks-publish',
  /** The content's locale or a section's lang uses a script the typography profile lacks. */
  'appearance.script-coverage': 'warning',
} as const satisfies Record<string, DiagnosticSeverity>;

export type AppearanceCode = keyof typeof APPEARANCE_CODES;

/** One finding about a selection, before a validator locates it in a document. */
export interface AppearanceDiagnostic {
  readonly code: AppearanceCode | 'schema.invalid' | 'variant.unavailable';
  /** The value it's about. */
  readonly axis: AppearanceAxis;
  /** Never repeats a value the selection holds unless the registry registers it. */
  readonly message: string;
  readonly remediation: string;
}
