import { focusPerimeter } from './focus-perimeter';

// Editorial Evidence's title links in Accessible Reading at 1440: a plate's title link and the
// first offer's name link. Each one's underline, at the shared offset, sits along its focus
// ring's foot, so a ring drawn in the underline's colour reads as no change there.
focusPerimeter('editorial-evidence', 'platform-neutral/warm-parchment/accessible-reading/system', [
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
