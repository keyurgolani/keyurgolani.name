import type { CoreRenderers } from '@portfolio/kit/sections';
import { Chronology } from './chronology';
import { EvidenceTile } from './evidence';
import { Contact, Cta, Focus, FunFacts, Hero, Lede, Now, Quote } from './identity';
import { Custom, Github } from './other';
import { Practice } from './practice';
import { Works } from './works';

// Spatial Bento's own renderer for every core kind: no section on its page
// goes through the kit's shared renderers.

export const RENDERERS: CoreRenderers = {
  hero: Hero,
  lede: Lede,
  now: Now,
  focus: Focus,
  'fun-facts': FunFacts,
  quote: Quote,
  contact: Contact,
  cta: Cta,
  works: Works,
  evidence: EvidenceTile,
  chronology: Chronology,
  practice: Practice,
  github: Github,
  custom: Custom,
};
