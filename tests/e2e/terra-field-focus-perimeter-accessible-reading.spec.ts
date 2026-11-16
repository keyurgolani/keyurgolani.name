import { focusPerimeter } from './focus-perimeter';

focusPerimeter('terra-field', 'platform-neutral/warm-parchment/accessible-reading/system', [
  {
    name: 'award title link',
    selector: 'role=link[name="Award name"]',
    widths: [1440, 390],
    rows: ['forced-colors'],
  },
  {
    name: 'project title link',
    selector: 'role=link[name="Project name"]',
    widths: [1440, 390],
    rows: ['forced-colors'],
  },
  {
    name: 'writing title link',
    selector: 'role=link[name="Writing title"]',
    widths: [1440, 390],
    rows: ['forced-colors'],
  },
]);
