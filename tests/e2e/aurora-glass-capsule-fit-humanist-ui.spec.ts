import { test } from '../harness/fixtures';
import { capsuleFit, capsuleFitOptions } from './aurora-glass-capsule-fit';

// Row 150 on the humanist-ui type pack: see aurora-glass-capsule-fit.ts.
test.use({ appOptions: capsuleFitOptions('humanist-ui') });

capsuleFit('humanist-ui');
