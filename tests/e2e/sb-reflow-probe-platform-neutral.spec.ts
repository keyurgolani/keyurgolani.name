// Rows 45/50 CI probe, evidence only, not for merge: Spatial Bento's home under platform-neutral (sb-reflow-probe.ts).
import { test } from '../harness/fixtures';
import { sbProbe, sbProbeTitle, sbProbeUse } from './sb-reflow-probe';

test.use(sbProbeUse('platform-neutral'));
test(sbProbeTitle('platform-neutral'), sbProbe('platform-neutral'));
