// Rows 45/50 CI probe, evidence only, not for merge: Spatial Bento's home under material-3-inspired (sb-reflow-probe.ts).
import { test } from '../harness/fixtures';
import { sbProbe, sbProbeTitle, sbProbeUse } from './sb-reflow-probe';

test.use(sbProbeUse('material-3-inspired'));
test(sbProbeTitle('material-3-inspired'), sbProbe('material-3-inspired'));
