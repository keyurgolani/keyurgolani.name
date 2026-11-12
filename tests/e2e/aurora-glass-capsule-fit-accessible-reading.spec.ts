import { test } from '../harness/fixtures';
import { capsuleFit, capsuleFitOptions } from './aurora-glass-capsule-fit';

// Row 150 on the accessible-reading type pack: see aurora-glass-capsule-fit.ts.
test.use({ appOptions: capsuleFitOptions('accessible-reading') });

capsuleFit('accessible-reading');
