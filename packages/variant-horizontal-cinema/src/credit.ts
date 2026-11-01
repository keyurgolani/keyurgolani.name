import type { Evidence, Work } from '@portfolio/schema';
import { chronologyOf, evidenceOf, worksByIds } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { PlacedScene } from './scenes';

// What a scene's bottom bar credits it with (redesign): a fact about what
// the scene holds, a noun and a measure, "3 episodes, 156 minutes", on one
// line. Never the scene's own words again: a section's subtitle reads in
// the picture, so the bar never repeats it. A scene with nothing to count
// takes no credit.

type ViewSection = VariantRenderInput['portfolio']['sections'][number];

/** `1 essay`, `3 essays`. */
const counted = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** What a medium's works are called when they're all one medium. */
const NOUNS: Readonly<Record<string, readonly [string, string?]>> = {
  writing: ['essay'],
  'audio-video': ['episode'],
  software: ['project'],
  research: ['paper'],
  photography: ['photograph'],
  music: ['release'],
};

/** A set of works, counted: by their medium's noun where they share one, with a running time where they have one. */
function worksCredit(works: readonly Work[]): string | undefined {
  if (works.length === 0) return undefined;
  if (works.length === 1) {
    const [work] = works;
    const tracks = work!.tracks ?? [];
    if (tracks.length > 0) {
      const seconds = tracks.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0);
      return seconds > 0
        ? `${counted(tracks.length, 'track')}, ${Math.round(seconds / 60)} minutes`
        : counted(tracks.length, 'track');
    }
    const pictures = (work!.media ?? []).length;
    if (pictures > 1) return counted(pictures, 'photograph');
  }
  const media = new Set(works.map((work) => work.medium));
  const noun = media.size === 1 ? NOUNS[[...media][0]!] : undefined;
  const count = noun ? counted(works.length, noun[0], noun[1]) : counted(works.length, 'work');
  const listening = works.reduce((sum, work) => sum + (work.durationMinutes ?? 0), 0);
  if (listening > 0) return `${count}, ${listening} minutes`;
  const reading = works.reduce((sum, work) => sum + (work.readingTimeMinutes ?? 0), 0);
  if (reading > 0) return `${count}, ${reading} minutes of reading`;
  return count;
}

/** What an evidence type is called, counted. */
const EVIDENCE_NOUNS: Readonly<Record<Evidence['type'], readonly [string, string?]>> = {
  metric: ['figure'],
  testimonial: ['testimonial'],
  publication: ['publication'],
  talk: ['talk'],
  award: ['award'],
  patent: ['patent'],
  press: ['press piece'],
  exhibition: ['exhibition'],
  client: ['client'],
  recording: ['recording'],
  repository: ['repository', 'repositories'],
  'external-work': ['link'],
};

/** A scene's sections, counted: what they hold, by type where it's one. */
export function sectionsCredit(
  sections: readonly ViewSection[],
  input: VariantRenderInput,
): string | undefined {
  const evidence = sections.flatMap((section) => evidenceOf(section, input));
  const entries = sections.flatMap((section) => chronologyOf(section, input));
  if (evidence.length > 0 && entries.length === 0) {
    const types = [...new Set(evidence.map((entry) => entry.type))];
    if (types.length === 1) {
      return counted(evidence.length, ...EVIDENCE_NOUNS[types[0]!]!);
    }
    return types.length <= 2
      ? types
          .map((type) =>
            counted(
              evidence.filter((entry) => entry.type === type).length,
              ...EVIDENCE_NOUNS[type]!,
            ),
          )
          .join(' and ')
      : counted(evidence.length, 'record');
  }
  return undefined;
}

/** What a section of the full record holds, counted: "5 talks", "4 entries". */
export function recordCredit(section: ViewSection, input: VariantRenderInput): string | undefined {
  const entries = chronologyOf(section, input);
  if (entries.length > 0) return counted(entries.length, 'entry', 'entries');
  return sectionsCredit([section], input);
}

/** The credit a scene's bottom bar reads, or none. */
export function creditOf(scene: PlacedScene, input: VariantRenderInput): string | undefined {
  switch (scene.kind) {
    case 'lead':
      return scene.work.role?.trim() || undefined;
    case 'reel': {
      const fact =
        scene.section.kind === 'works'
          ? worksCredit(
              worksByIds(
                scene.items.map((item) => item.id),
                input,
              ),
            )
          : counted(scene.items.length, 'entry', 'entries');
      if (scene.parts === 1) return fact;
      return `${fact ? `${fact}, ` : ''}part ${scene.part + 1} of ${scene.parts}`;
    }
    case 'sections':
      return sectionsCredit(scene.sections, input);
    default:
      return undefined;
  }
}
