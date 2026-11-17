import { focusPerimeter } from './aurora-glass-focus-perimeter';

// Under more contrast on-accent is the canvas's white, and a focused pill takes the control
// radius: the corners its ring then lies in showed the canvas at rest, so a ring there in
// on-accent changes nothing. The primary actions keep a ring the focus check reads whole.
focusPerimeter('platform-neutral/warm-parchment/editorial-serif/system', [
  {
    name: "opening's primary action",
    selector: '#top .ag-id__acts > a:nth-child(1)',
    widths: [390],
    rows: ['default', 'contrast-more'],
  },
  {
    name: "closing call's primary action",
    selector: '#cta .ag-offer__acts > a:nth-child(1)',
    widths: [390],
    rows: ['default', 'contrast-more'],
  },
]);
