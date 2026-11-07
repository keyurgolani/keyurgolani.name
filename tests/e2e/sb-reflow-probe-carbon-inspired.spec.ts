// Rows 45/50 CI probe, evidence only, not for merge: Spatial Bento's home under carbon-inspired (sb-reflow-probe.ts).
import { test } from '../harness/fixtures';
import { sbProbe, sbProbeTitle, sbProbeUse } from './sb-reflow-probe';

test.use(sbProbeUse('carbon-inspired'));
test(sbProbeTitle('carbon-inspired'), sbProbe('carbon-inspired'));
