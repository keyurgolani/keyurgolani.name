import { composePages } from '@portfolio/kit/sections';
import { CaseStudyPage } from './case-study';
import { HomePage } from './home';

// Pull Request (issue #270): the portfolio as a pull request to the
// reader's team, titled for them, read as a review page. Home is the
// review: the conversation, the commits, the checks and the files changed,
// with the merge box beside them; a work's own page, /work/<slug>
// (routes.work: bespoke), is its whole diff.

const PullRequest = composePages({ HomePage, CaseStudyPage });

export default PullRequest;
