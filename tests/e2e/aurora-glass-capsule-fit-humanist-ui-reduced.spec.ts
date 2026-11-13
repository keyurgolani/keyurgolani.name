import { test } from '../harness/fixtures';
import { capsuleFit, capsuleFitOptions } from './aurora-glass-capsule-fit';

// Row 150's capsule-fit pins under reduced motion too (the coordinator's (a)): there a still Pause and its held note
// show, so the capsule's need beside the ornament is read in both settings, and the fold covers the larger.
test.use({
  appOptions: capsuleFitOptions('humanist-ui'),
  contextOptions: { reducedMotion: 'reduce' },
});

capsuleFit('humanist-ui');
