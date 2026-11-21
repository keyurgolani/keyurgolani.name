import { test } from '../harness/fixtures';
import { focusPerimeter } from './aurora-glass-focus-perimeter';

// On a phone the signature sheet laps the opening pane's foot just under its primary action, and
// paints over the pane: its card shadow, in neumorphic a light highlight thrown up and to the
// start, lies over the bottom of the action's ring. In a light scheme that highlight is near the
// canvas, and the ring under it reads short of 3:1 against the same pixels at rest. The action
// rings whole when focused, as the focus check reads it on a phone: a touch viewport, as the 390
// quality cells emulate.
test.use({ isMobile: true, hasTouch: true });

focusPerimeter('neumorphic/warm-parchment/humanist-ui/system', [
  {
    name: "opening's primary action",
    selector: '#top .ag-id__acts > a:nth-child(1)',
    widths: [390],
  },
]);
