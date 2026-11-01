import type { Section } from '@portfolio/schema';
import type { SectionRendererProps } from '@portfolio/kit/sections';
import { evidenceRuns } from '../model';
import { Cascade } from './cascade';
import { MetricLites } from './lites';
import { Portals } from './portals';
import { RecordRows } from './record-pane';

// Evidence (brief §5.2, evidence by type; AG-M3): metrics as lites, one
// pane split by mullions; testimonials as the cascade; publications, talks,
// awards, patents and press as rows inside the band's one pane, never
// free-standing cards; external work as portal sheets. A mixed section
// shows each run of one form in its form, in the owner's order.

type EvidenceSection = Extract<Section, { kind: 'evidence' }>;

export function EvidenceRenderer({ section, input }: SectionRendererProps<EvidenceSection>) {
  return (
    <>
      {evidenceRuns(section, input).map((run, index) => {
        const key = `${run.form}-${index}`;
        switch (run.form) {
          case 'lites':
            return <MetricLites key={key} entries={run.items} section={section} input={input} />;
          case 'cascade':
            return <Cascade key={key} entries={run.items} section={section} input={input} />;
          case 'portals':
            return <Portals key={key} entries={run.items} section={section} input={input} />;
          default:
            return <RecordRows key={key} entries={run.items} section={section} input={input} />;
        }
      })}
    </>
  );
}
