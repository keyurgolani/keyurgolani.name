import { missionRings } from './mission-control-ring';

// A folded panel's bar, the summary that opens it, spans its panel, so Blueprint's ring, 4 px wide
// and 3 px off, lay outside the panel, over its border, the seam and the next panel: its top side
// read under 3:1 on all but a few points under forced colours at 1024 (Skills, Publications,
// Education, Press), and on CI Linux under more contrast too. Each bar's ring lies inside its panel
// and passes the focus check.
missionRings({
  tuple: {
    language: 'blueprint',
    scheme: 'low-stimulus-warm',
    typography: 'neutral-ui',
    mode: 'dark',
  },
  viewport: { width: 1024, height: 768 },
  rows: [
    { label: 'under forced colours', contrast: 'no-preference', forcedColors: 'active' },
    { label: 'under more contrast', contrast: 'more', forcedColors: 'none' },
    { label: 'by default', contrast: 'no-preference', forcedColors: 'none' },
  ],
  what: "the folded panels' bars",
  targets: '.mc-panel--fold > details.mc-fold > summary',
  insidePanel: true,
});
