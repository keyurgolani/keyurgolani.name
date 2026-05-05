import type { Section } from '@portfolio/schema';

export function SectionDispatch({ section }: { section: Section }) {
  switch (section.kind) {
    case 'hero':
      return null;
    case 'lede':
      return null;
    case 'now':
      return null;
    case 'experience':
      return null;
    case 'education':
      return null;
    case 'projects':
      return null;
    case 'writings':
      return null;
    case 'publications':
      return null;
    case 'talks':
      return null;
    case 'awards':
      return null;
    case 'episodes':
      return null;
    case 'patents':
      return null;
    case 'gallery':
      return null;
    case 'discography':
      return null;
    case 'testimonials':
      return null;
    case 'press':
      return null;
    case 'quote':
      return null;
    case 'skills':
      return null;
    case 'stack':
      return null;
    case 'services':
      return null;
    case 'contact':
      return null;
    case 'cta':
      return null;
    case 'stats':
      return null;
    case 'focus':
      return null;
    case 'fun-facts':
      return null;
    case 'tenure':
      return null;
    case 'external-portfolios':
      return null;
    case 'github':
      return null;
    default:
      return null;
  }
}
