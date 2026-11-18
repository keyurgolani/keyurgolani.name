import { focusPerimeter } from './focus-perimeter';

// The seal sits on the opening's arc, half on the field and half on the paper, so it can land on
// the window's bottom edge: at 1024x768 in this tuple its link's box ends at the fold and its ring
// runs a few pixels past it. Focused, the whole ring is in view and reads round, as at 1440 and 390.
focusPerimeter('terra-field', 'platform-neutral/warm-parchment/technical-sans-mono/system', [
  { name: 'seal link', selector: 'a.tf-seal__link', widths: [1024, 1440, 390] },
]);
