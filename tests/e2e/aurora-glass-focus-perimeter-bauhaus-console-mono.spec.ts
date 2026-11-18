import { focusPerimeter } from './aurora-glass-focus-perimeter';

// The capsule's contact action rings whole when focused on a language whose raised shadow paints
// the capsule's foot in the accent, taller than the capsule's padding: in the default and the
// more-contrast rows, where the focus colour is the accent or under 3:1 on it.
focusPerimeter('bauhaus-geometric/blue-orange-color-safe/console-mono/light', [
  {
    name: "capsule's contact action",
    selector: '.ag-capsule > .ag-capsule__cta',
    widths: [1440, 1024],
  },
  {
    name: "capsule's contact action",
    selector: '.ag-capsule > .ag-capsule__cta',
    widths: [1440],
    rows: ['contrast-more'],
  },
]);
