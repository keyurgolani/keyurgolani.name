import { focusPerimeter } from './focus-perimeter';

focusPerimeter('terra-field', 'platform-neutral/warm-parchment/humanist-ui/light', [
  {
    name: 'All work link',
    selector: 'role=link[name="All work"]',
    // A case study with no next one goes on to All work: the complete fixture's one case.
    route: '/work/project-name',
    widths: [1440, 1024, 390],
    rows: ['default', 'forced-colors'],
  },
]);
