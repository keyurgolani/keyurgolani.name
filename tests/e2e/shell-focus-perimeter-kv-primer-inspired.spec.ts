import { focusPerimeter } from './focus-perimeter';

// Shell's opening key and value list at 1440 under forced colours in primer-inspired, which forced
// colours draw as they do every language: the mail link and the first proof link ring whole.
focusPerimeter('shell', 'primer-inspired/warm-parchment/humanist-ui/system', [
  {
    name: "opening's mail link",
    selector: '#top .sh-kv dd > a[href^="mailto:"]',
    widths: [1440],
    rows: ['forced-colors'],
  },
  {
    name: "opening's first proof link",
    selector: '#top .sh-kv__list--rows > li:first-child > a',
    widths: [1440],
    rows: ['forced-colors'],
  },
]);
