import { focusPerimeter } from './aurora-glass-focus-perimeter';

// The primary actions ring whole when focused, as the focus check reads them, at every width.
focusPerimeter('glassmorphism/sunset-ember/accessible-reading/dark', [
  {
    name: "opening's primary action",
    selector: '#top .ag-id__acts > a:nth-child(1)',
    widths: [1440, 1024, 390],
  },
  {
    name: "closing call's primary action",
    selector: '#cta .ag-offer__acts > a:nth-child(1)',
    widths: [1440, 1024, 390],
  },
]);
