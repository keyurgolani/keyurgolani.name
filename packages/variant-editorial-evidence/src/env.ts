import type { HomeModel } from './model';

// Where a section renders, apart from the frames that set it and the
// renderers that fill it, so each imports this and not the other.

/** Where a section renders: in a chapter's band, in a band's margin, or in the opening. */
export type Place = 'band' | 'margin' | 'opening';

/** What a section's renderer knows of where it is. */
export interface Env {
  readonly model: HomeModel;
  readonly place: Place;
}
