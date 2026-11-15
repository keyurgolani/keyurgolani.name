import { focusPerimeter } from './aurora-glass-focus-perimeter';

focusPerimeter('fluent-2-inspired/warm-parchment/humanist-ui/system', [
  {
    name: "opening's primary action",
    selector: '#top .ag-id__acts > a:nth-child(1)',
    widths: [1440, 1024, 390],
  },
  {
    name: "closing call's primary action",
    selector: '#cta .ag-offer__acts > a:nth-child(1)',
    widths: [1440, 390],
  },
]);
