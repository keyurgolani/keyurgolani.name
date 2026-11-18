import { focusPerimeter } from './aurora-glass-focus-perimeter';

// On a pill a focused primary action took the control radius, and an inset ring there lay where the
// resting pill's round ends show the pane, and its inner row over the fill at a sub-pixel box: the
// focus check read about a third of the ring. The primary actions ring whole at every width.
focusPerimeter('platform-neutral/night-terminal/humanist-ui/light', [
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
