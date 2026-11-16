import { focusPerimeter } from './focus-perimeter';

focusPerimeter('editorial-evidence', 'platform-neutral/warm-parchment/accessible-reading/system', [
  {
    name: 'writing title link',
    selector: 'role=link[name="Writing title"]',
    route: '/work/project-name',
    widths: [1440],
    rows: ['contrast-more', 'forced-colors'],
  },
  {
    name: 'name link',
    selector: 'role=link[name="Rowan Vale"]',
    widths: [390],
    rows: ['forced-colors'],
  },
]);
