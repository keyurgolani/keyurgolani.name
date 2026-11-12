import { test } from '../harness/fixtures';
import { ringPlaque, ringPlaqueOptions } from './obsidian-atelier-ring-plaque-diagnostic';

// DIAGNOSTIC (evidence branch only): row 121 in the high-contrast display mode; see
// obsidian-atelier-ring-plaque-diagnostic.ts.
test.use({ appOptions: ringPlaqueOptions('high-contrast') });

ringPlaque('high-contrast');
