// Rows 45/50 CI probe, evidence only, not for merge: Spatial Bento's home under minimal-flat (sb-reflow-probe.ts).
import { test } from '../harness/fixtures';
import { sbProbe, sbProbeTitle, sbProbeUse } from './sb-reflow-probe';

test.use(sbProbeUse('minimal-flat'));
test(sbProbeTitle('minimal-flat'), sbProbe('minimal-flat'));
