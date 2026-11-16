import { focusPerimeter } from './focus-perimeter';

focusPerimeter('editorial-evidence', 'platform-neutral/warm-parchment/humanist-ui/high-contrast', [
  {
    name: 'repository link',
    selector: 'role=link[name="code.rowan.test/tide"]',
    route: '/work/project-name',
    widths: [1440, 1024],
    rows: ['default', 'contrast-more', 'forced-colors'],
  },
]);
