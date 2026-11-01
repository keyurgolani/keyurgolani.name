import { composePages } from '@portfolio/kit/sections';
import { BackMatterPage } from './back';
import { CaseStudyPage } from './case';
import { ChapterPage, knownChapter } from './chapter';
import { HomePage } from './front';

// Chapters: the portfolio as a short bound book. Home is the front matter,
// each era of the chronology is a chapter at /chapters/<chapter>, and the
// back matter ends with an index. A work's case study is a section of its
// chapter. Every page renders on the server from the render input alone, so
// it reads without JavaScript and after a refresh; changing chapter is a
// cross-document view transition the host opts the composition into.

export default composePages({
  HomePage,
  CaseStudyPage,
  views: {
    chapter: { Page: ChapterPage, known: knownChapter, unknown: 'No chapter by that name.' },
    'back-matter': BackMatterPage,
  },
});
