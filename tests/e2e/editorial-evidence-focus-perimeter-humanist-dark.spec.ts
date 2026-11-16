import { focusPerimeter } from './focus-perimeter';

focusPerimeter('editorial-evidence', 'platform-neutral/warm-parchment/humanist-ui/dark', [
  {
    name: 'writing title link',
    selector: 'role=link[name="Writing title"]',
    route: '/work/project-name',
    widths: [1440],
    rows: ['contrast-more', 'forced-colors'],
  },
]);
