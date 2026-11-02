import type { Section } from '@portfolio/schema';
import { evidenceOf, worksOf } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Which form a section takes, by the shape of its content, never by its id
// or title (brief §5.3): works by medium, evidence by type, practice by
// part. The frame sets the shape as the band's class, and the renderer
// draws the same form.

export type Shape =
  | 'board'
  | 'rows'
  | 'table'
  | 'frames'
  | 'album'
  | 'facts'
  | 'notes'
  | 'stack'
  | 'skills'
  | 'tools'
  | 'about'
  | 'now'
  | 'list'
  | 'oddities'
  | 'quote'
  | 'github'
  | 'ink';

const WRITTEN = new Set(['writing', 'research']);
const PHOTOGRAPHS = new Set(['photography', 'image-series']);

/** Whether every record has a value the test accepts. */
const all = <T>(records: readonly T[], test: (record: T) => boolean) =>
  records.length > 0 && records.every(test);

export function shapeOf(section: Section, input: VariantRenderInput): Shape {
  switch (section.kind) {
    case 'works': {
      const works = worksOf(section, input);
      if (all(works, (work) => WRITTEN.has(work.medium))) return 'rows';
      if (all(works, (work) => work.medium === 'audio-video')) return 'table';
      if (all(works, (work) => PHOTOGRAPHS.has(work.medium) && (work.media?.length ?? 0) > 0)) {
        return 'frames';
      }
      if (all(works, (work) => work.medium === 'music')) return 'album';
      return 'board';
    }
    case 'evidence': {
      const records = evidenceOf(section, input);
      if (
        all(records, (record) => record.type === 'metric' && record.metric?.value !== undefined)
      ) {
        return 'facts';
      }
      if (all(records, (record) => record.type === 'testimonial')) return 'notes';
      if (all(records, (record) => record.type === 'talk')) return 'table';
      return 'stack';
    }
    case 'chronology':
      return 'table';
    case 'practice':
      if (section.part === 'skills') return 'skills';
      if (section.part === 'tools') return 'tools';
      if (section.part === 'services') return 'board';
      return 'about';
    case 'lede':
      return 'about';
    case 'now':
      return 'now';
    case 'focus':
      return 'list';
    case 'fun-facts':
      return 'oddities';
    case 'quote':
      return 'quote';
    case 'github':
      return 'github';
    case 'contact':
    case 'cta':
      return 'ink';
    default:
      return 'stack';
  }
}
