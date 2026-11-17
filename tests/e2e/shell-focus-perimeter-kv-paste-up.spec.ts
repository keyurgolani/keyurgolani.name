import { focusPerimeter } from './focus-perimeter';

// Shell's opening key and value list at 1440 under forced colours in paste-up, whose line is a
// target tall, so the proof list's links stand line on line with no space between them: the mail
// link and the proof links, the first, a dated one and an undated one, ring whole.
focusPerimeter('shell', 'platform-neutral/warm-parchment/paste-up/system', [
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
  {
    name: "opening's award proof link",
    selector: '#top .sh-kv__list--rows > li > a:has-text("Award name")',
    widths: [1440],
    rows: ['forced-colors'],
  },
  {
    name: "opening's client proof link",
    selector: '#top .sh-kv__list--rows > li > a:has-text("Client name")',
    widths: [1440],
    rows: ['forced-colors'],
  },
]);
