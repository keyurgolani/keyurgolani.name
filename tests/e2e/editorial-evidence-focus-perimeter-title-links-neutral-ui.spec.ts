import { focusPerimeter } from './focus-perimeter';

// Editorial Evidence's title links in Neutral UI at 1440, where a work row's title link, a plate's
// title link and the first offer's name link each set the underline, at the shared offset, at or
// just past their box's foot, at the inner edge of the focus ring's band.
focusPerimeter('editorial-evidence', 'platform-neutral/warm-parchment/neutral-ui/system', [
  {
    name: "first work row's title link",
    selector: '.ee-row__title a >> nth=0',
    widths: [1440],
    rows: ['default', 'contrast-more', 'forced-colors'],
  },
  {
    name: "writing plate's title link",
    selector: '#ee--plate-writing-title--title a',
    widths: [1440],
    rows: ['default', 'contrast-more', 'forced-colors'],
  },
  {
    name: "first offer's name link",
    selector: '.ee-offers > li:first-child .ee-offer__name a',
    widths: [1440],
    rows: ['default', 'contrast-more', 'forced-colors'],
  },
]);
