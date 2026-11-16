import { missionRings } from './mission-control-ring';

// A role's organisation and place, a link on the experience record: on a phone in Letterpress on
// Warm Parchment its ring read under 3:1 on about half its centre line (397 of 744 points), under
// more contrast and forced colours.
missionRings({
  tuple: {
    language: 'letterpress',
    scheme: 'warm-parchment',
    typography: 'humanist-ui',
    mode: 'system',
  },
  viewport: { width: 390, height: 844 },
  rows: [
    { label: 'under more contrast', contrast: 'more', forcedColors: 'none' },
    { label: 'under forced colours', contrast: 'no-preference', forcedColors: 'active' },
  ],
  what: "the experience record's organisation link",
  targets: '#experience-role-experience-organization > div:nth-child(2) > p:nth-child(2) > a',
});
