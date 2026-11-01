import type { Work } from '@portfolio/schema';

// Words Horizontal Cinema shares across its frames.

/** Whether `text` has something to show. */
export function present(text: string | undefined | null): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

/** The medium in words, for a frame's label. None for an extension's medium, which names itself. */
export function mediumLabel(work: Pick<Work, 'medium'>): string | undefined {
  const labels: Record<string, string> = {
    interface: 'Interface',
    system: 'System',
    software: 'Software',
    photography: 'Photography',
    'image-series': 'Image series',
    writing: 'Writing',
    research: 'Research',
    music: 'Music',
    'audio-video': 'Audio and video',
    object: 'Object',
  };
  return Object.hasOwn(labels, work.medium) ? labels[work.medium] : undefined;
}
