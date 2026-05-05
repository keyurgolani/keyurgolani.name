import type { Portfolio, Section } from '@portfolio/schema';
import { HeroRenderer } from './renderers/hero';
import { LongFormRenderer } from './renderers/long-form';
import { ExperienceRenderer } from './renderers/experience';
import { EducationRenderer } from './renderers/education';
import { ProjectsRenderer } from './renderers/projects';
import { WritingsRenderer } from './renderers/writings';
import { PublicationsRenderer } from './renderers/publications';
import { TalksRenderer } from './renderers/talks';
import { AwardsRenderer } from './renderers/awards';
import { EpisodesRenderer } from './renderers/episodes';
import { PatentsRenderer } from './renderers/patents';
import { GalleryRenderer } from './renderers/gallery';
import { DiscographyRenderer } from './renderers/discography';
import { TestimonialsRenderer } from './renderers/testimonials';
import { PressRenderer } from './renderers/press';
import { QuoteRenderer } from './renderers/quote';
import { SkillsRenderer } from './renderers/skills';
import { StackRenderer } from './renderers/stack';
import { ServicesRenderer } from './renderers/services';
import { ContactRenderer } from './renderers/contact';
import { CtaRenderer } from './renderers/cta';
import { StatsRenderer } from './renderers/stats';
import { FocusRenderer } from './renderers/focus';
import { FunFactsRenderer } from './renderers/fun-facts';
import { TenureRenderer } from './renderers/tenure';
import { ExternalPortfoliosRenderer } from './renderers/external-portfolios';
import { GithubRenderer } from './renderers/github';

interface DispatchProps {
  section: Section;
  portfolio: Portfolio;
}

export function SectionDispatch({ section, portfolio }: DispatchProps) {
  if (section.hidden) return null;
  switch (section.kind) {
    case 'hero':
      return <HeroRenderer section={section} identity={portfolio.identity} />;
    case 'lede':
    case 'now':
      return <LongFormRenderer section={section} />;
    case 'experience':
      return <ExperienceRenderer section={section} />;
    case 'education':
      return <EducationRenderer section={section} />;
    case 'projects':
      return <ProjectsRenderer section={section} />;
    case 'writings':
      return <WritingsRenderer section={section} />;
    case 'publications':
      return <PublicationsRenderer section={section} />;
    case 'talks':
      return <TalksRenderer section={section} />;
    case 'awards':
      return <AwardsRenderer section={section} />;
    case 'episodes':
      return <EpisodesRenderer section={section} />;
    case 'patents':
      return <PatentsRenderer section={section} />;
    case 'gallery':
      return <GalleryRenderer section={section} />;
    case 'discography':
      return <DiscographyRenderer section={section} />;
    case 'testimonials':
      return <TestimonialsRenderer section={section} />;
    case 'press':
      return <PressRenderer section={section} />;
    case 'quote':
      return <QuoteRenderer section={section} />;
    case 'skills':
      return <SkillsRenderer section={section} />;
    case 'stack':
      return <StackRenderer section={section} />;
    case 'services':
      return <ServicesRenderer section={section} />;
    case 'contact':
      return <ContactRenderer section={section} fallbackLinks={portfolio.links} />;
    case 'cta':
      return <CtaRenderer section={section} />;
    case 'stats':
      return <StatsRenderer section={section} />;
    case 'focus':
      return <FocusRenderer section={section} />;
    case 'fun-facts':
      return <FunFactsRenderer section={section} />;
    case 'tenure':
      return <TenureRenderer section={section} />;
    case 'external-portfolios':
      return <ExternalPortfoliosRenderer section={section} />;
    case 'github':
      return <GithubRenderer section={section} />;
    default: {
      const _exhaustive: never = section;
      void _exhaustive;
      return null;
    }
  }
}
