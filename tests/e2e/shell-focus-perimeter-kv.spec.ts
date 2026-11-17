import { focusPerimeter } from './focus-perimeter';

// Shell's opening key and value list at 1440: the mail line's link and the proof list's first
// link stand on stacked lines with no gap between them, so each one's focus ring reaches over
// the line above and the line below. Under forced colours the focus check reads about two fifths
// of each ring's centre line as no change.
focusPerimeter('shell', 'platform-neutral/warm-parchment/humanist-ui/system', [
  {
    name: "opening's mail link",
    selector: '#top .sh-kv dd > a[href^="mailto:"]',
    widths: [1440],
    rows: ['default', 'contrast-more', 'forced-colors'],
  },
  {
    name: "opening's first proof link",
    selector: '#top .sh-kv__list--rows > li:first-child > a',
    widths: [1440],
    rows: ['default', 'contrast-more', 'forced-colors'],
  },
]);
