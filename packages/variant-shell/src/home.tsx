import type { ReactElement } from 'react';
import { Enhancement } from '@portfolio/kit/enhancements';
import {
  navigationModel,
  renderSection,
  sectionRenders,
  type BespokeRenderers,
  type HomePageProps,
} from '@portfolio/kit/sections';
import { Footer } from './chrome/footer';
import { PaletteDialog } from './chrome/palette-dialog';
import { Pane, paneGroups, paneTotal } from './chrome/pane';
import { NoScriptMark, StatusLine } from './chrome/status-line';
import { shellFrame } from './frame';
import { controlsOf, cwdOf, thesisOf, transcriptOf } from './model';
import { Record } from './renderers/evidence';
import { GitLog } from './renderers/git-log';
import { Cat, Facts, Finger, Gh, Jobs, Lede, MailTo, Motd, Whiptail } from './renderers/lines';
import { Practice } from './renderers/practice';
import { Whoami } from './renderers/whoami';
import { LsWorks } from './renderers/works';

// Shell's home (brief §5.6): one open terminal session. The transcript
// runs by directory (SH-M2), each section in the shell frame; the index
// docks beside it at 1280 px and up (SH-M3) and is an in-flow nav below;
// the tmux status line holds the name and the five destinations; the
// palette dialog and the scroll spy are the one enhancement.

/** Every core kind, custom's own content included: the composition prints each itself. */
export const RENDERERS = {
  hero: Whoami,
  lede: Lede,
  works: LsWorks,
  evidence: Record,
  chronology: GitLog,
  practice: Practice,
  contact: MailTo,
  now: Finger,
  quote: Motd,
  focus: Jobs,
  'fun-facts': Facts,
  cta: Whiptail,
  github: Gh,
  custom: Cat,
} satisfies BespokeRenderers;

/** The chrome's ids. Two hyphens: no content id has them. */
export const chromeIds = (prefix: string) => ({
  index: `${prefix}shell--index`,
  dialog: `${prefix}shell--jump`,
});

/** With no hero to lead, the page's h1 is still the thesis, the name its prefix (N5). */
function Thesis({ input }: { input: HomePageProps['input'] }) {
  const thesis = thesisOf(input);
  return (
    <h1 className="sh-who__h">
      {thesis.source === 'name' ? null : (
        <span className="sh-who__name">
          {input.portfolio.identity.name}
          <span className="sh-sr">: </span>
        </span>
      )}
      <span className="sh-who__thesis">{thesis.text}</span>
    </h1>
  );
}

export function HomePage({ input, outline }: HomePageProps) {
  const model = navigationModel(outline);
  const shown = input.portfolio.sections.filter((section) => sectionRenders(section, input));
  const entries = transcriptOf(shown, outline, model);
  const plan = new Map(entries.map((entry) => [entry.section.id, entry]));
  const composition = { renderers: RENDERERS, Frame: shellFrame(input, plan) };
  // The page's one h1 is the first hero's; any later hero, and every other section, is an h2.
  let heroLeads = false;
  const blocks: ReactElement[] = [];
  for (const { section } of entries) {
    const leads: boolean = !heroLeads && section.kind === 'hero';
    const element = renderSection(section, input, composition, { level: leads ? 1 : 2 });
    if (element === null) continue;
    heroLeads ||= leads;
    blocks.push(element);
  }
  const groups = paneGroups(entries, outline, input);
  const ids = chromeIds(input.ids.prefix);
  const total = paneTotal(groups);
  return (
    <>
      <div className="sh-session" data-sh-session="" data-pane={controlsOf(input).pane}>
        <NoScriptMark />
        <main id={input.ids.main} className="sh-main" tabIndex={-1}>
          {heroLeads ? null : (
            <>
              <Thesis input={input} />
              {/* With no whoami, the directories still reach a phone, whose bar has no windows. */}
              {model.primary.length > 0 ? (
                <nav className="sh-complete" aria-label="Directories">
                  <ul>
                    {model.primary.map((destination) => (
                      <li key={destination.id}>
                        <a href={destination.href} lang={destination.lang}>
                          {cwdOf(destination.id, model).slice(2)}/
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              ) : null}
            </>
          )}
          {blocks}
        </main>
        {groups.length > 0 ? <Pane input={input} groups={groups} id={ids.index} /> : null}
        <Footer input={input} />
      </div>
      <StatusLine
        input={input}
        model={model}
        total={total}
        indexHref={`#${ids.index}`}
        dialogId={ids.dialog}
      />
      <PaletteDialog input={input} id={ids.dialog} />
      <Enhancement input={input} id="palette" />
    </>
  );
}
