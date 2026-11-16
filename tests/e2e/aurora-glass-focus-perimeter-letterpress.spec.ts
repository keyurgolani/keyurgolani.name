import { focusPerimeter } from './aurora-glass-focus-perimeter';

focusPerimeter('letterpress/ocean-abyss/editorial-serif/dark', [
  {
    name: "contact's address",
    selector: '#contact .ag-call__mail > a',
    widths: [390],
    rows: ['default', 'contrast-more', 'forced-colors'],
  },
  {
    name: "opening's primary action",
    selector: '#top .ag-id__acts > a:nth-child(1)',
    widths: [390],
    rows: ['forced-colors'],
  },
  {
    name: "closing call's primary action",
    selector: '#cta .ag-offer__acts > a:nth-child(1)',
    widths: [390],
    rows: ['forced-colors'],
  },
]);
