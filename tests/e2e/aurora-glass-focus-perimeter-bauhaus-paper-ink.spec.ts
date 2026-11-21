import { focusPerimeter } from './aurora-glass-focus-perimeter';

// The capsule's contact action rings whole when focused on a scheme whose surface is under 3:1 on
// the accent: the language's raised shadow paints the capsule's foot in the accent, taller than the
// capsule's padding, so the ring's lower part lies on that foot, and a band of the surface under the
// focused call changes the foot by less than 3:1. In dark paper-ink with accessible reading at 1440.
focusPerimeter('bauhaus-geometric/paper-ink/accessible-reading/dark', [
  {
    name: "capsule's contact action",
    selector: '.ag-capsule > .ag-capsule__cta',
    widths: [1440],
  },
]);
