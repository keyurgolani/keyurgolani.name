import { focusPerimeter } from './focus-perimeter';

focusPerimeter('terra-field', 'platform-neutral/warm-parchment/accessible-reading/system', [
  {
    name: 'award title link',
    selector: 'role=link[name="Award name"]',
    widths: [1440, 390],
    rows: ['forced-colors'],
  },
  // The home page has two links named by the project, and each is read.
  {
    name: 'project title link',
    selector: 'role=link[name="Project name"] >> nth=0',
    widths: [1440, 390],
    rows: ['forced-colors'],
  },
  {
    name: "project's second link",
    selector: 'role=link[name="Project name"] >> nth=1',
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
