import type { Focus, FunFacts } from '@portfolio/schema';
import { renderContext, SectionHeader, TagList } from '../primitives';
import type { SectionRendererProps } from '../types';

// Short lists the owner writes out: what they're focused on, and things
// about them. Each has a heading only when the owner gives it a title.

export function FocusSection({ section, input, level }: SectionRendererProps<Focus>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <TagList items={section.items} className="pf-short-list" />
    </>
  );
}

export function FunFactsSection({ section, input, level }: SectionRendererProps<FunFacts>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <TagList items={section.items} className="pf-short-list" />
    </>
  );
}
