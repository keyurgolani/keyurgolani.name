import type { SectionRenderer, SectionOf } from '@portfolio/kit/sections';
import { anchorSection, hrefFor, navigationModel, pageOutline } from '@portfolio/kit/sections';
import { controlsOf, cwdOf, DIRECTORIES, proofLines, thesisOf } from '../model';
import { external, Link, Ps1, Sr, uiLangOf, Words } from '../parts';
import { promptOf } from '../model';

// whoami (hero): printed as neofetch would. The output's first line is the
// thesis (SH-M1, N5), the page's h1 with the owner's name as its visible
// prefix, the hero's lines as # comments under it; then a box rule, the
// identity as key and value facts with the curation proof, the owner's
// actions as whiptail buttons, and a tab completion of the five directories. No greeting comment (SH-M1: the
// thesis leads; the hero's greeting is ruled out in the quality unit).

export const Whoami: SectionRenderer<SectionOf<'hero'>> = ({ section, input, level }) => {
  const { portfolio } = input;
  const { identity } = portfolio;
  const uiLang = uiLangOf(input);
  const thesis = thesisOf(input);
  const name = (section.name ?? identity.name).trim();
  const Heading = `h${level}` as 'h1';
  const headingId = `${input.ids.prefix}${section.id}--h`;
  const proof = proofLines(input);
  // The hero's tagline, subtitle and subtagline print as # comment lines directly under the
  // thesis, the tagline unless it is the thesis, each once: whoami's own output, not a stack
  // of free paragraphs.
  const notes = [
    thesis.source === 'hero' ? undefined : section.tagline,
    section.subtitle,
    section.subtagline,
  ].filter(
    (text, i, all): text is string =>
      text !== undefined && text.trim() !== '' && text !== thesis.text && all.indexOf(text) === i,
  );
  const model = navigationModel(pageOutline(input));
  const directories = DIRECTORIES.flatMap((id) => model.primary.filter((d) => d.id === id));
  const { prompt } = controlsOf(input);
  return (
    <div className="sh-who">
      <Heading className="sh-who__h" id={headingId}>
        {thesis.source === 'name' ? (
          <span className="sh-who__thesis">{name}</span>
        ) : (
          <>
            <span className="sh-who__name">
              {name}
              <Sr>: </Sr>
            </span>
            <span className="sh-who__thesis">{thesis.text}</span>
          </>
        )}
      </Heading>
      {notes.length > 0 ? (
        <div className="sh-who__notes">
          {notes.map((text, i) => (
            <p key={i} className="sh-sub">
              <span className="sh-cmt__hash" aria-hidden="true">
                #{' '}
              </span>
              {text}
            </p>
          ))}
        </div>
      ) : null}
      <p className="sh-who__rule" aria-hidden="true" />
      <div className="sh-who__split">
        <dl className="sh-kv">
          {identity.tagline && thesis.source !== 'tagline' ? (
            <div>
              <dt>
                <Words lang={uiLang}>tagline</Words>
              </dt>
              <dd>{identity.tagline}</dd>
            </div>
          ) : null}
          {identity.pronouns ? (
            <div>
              <dt>
                <Words lang={uiLang}>pronouns</Words>
              </dt>
              <dd>{identity.pronouns}</dd>
            </div>
          ) : null}
          {identity.location ? (
            <div>
              <dt>
                <Words lang={uiLang}>location</Words>
              </dt>
              <dd>{identity.location}</dd>
            </div>
          ) : null}
          {identity.email ? (
            <div>
              <dt>
                <Words lang={uiLang}>mail</Words>
              </dt>
              <dd>
                <a href={`mailto:${identity.email.trim()}`}>{identity.email.trim()}</a>
              </dd>
            </div>
          ) : null}
          {proof.length > 0 ? (
            <div>
              <dt>
                <Words lang={uiLang}>proof</Words>
              </dt>
              <dd>
                <ul className="sh-kv__list sh-kv__list--rows">
                  {proof.map((line) => {
                    const home = anchorSection({ id: line.id }, input);
                    const body = (
                      <>
                        {line.figure ? <b className="sh-fig">{line.figure}</b> : null}
                        {line.figure && line.words ? ' ' : null}
                        {line.words}
                        {line.year ? <span className="sh-faint"> {line.year}</span> : null}
                      </>
                    );
                    return (
                      <li key={line.id}>
                        {home ? <a href={hrefFor(`#${home.id}`, input)}>{body}</a> : body}
                      </li>
                    );
                  })}
                </ul>
              </dd>
            </div>
          ) : null}
          {portfolio.links.length > 0 ? (
            <div>
              <dt>
                <Words lang={uiLang}>links</Words>
              </dt>
              <dd>
                <ul className="sh-kv__list">
                  {portfolio.links.map((link) => (
                    <li key={link.url}>
                      <Link url={link.url} input={input}>
                        {link.label ?? link.platform ?? link.url}
                      </Link>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="sh-who__pitch">
          {section.ctas && section.ctas.length > 0 ? (
            <ul className="sh-btns">
              {section.ctas.map((cta, i) => (
                <li key={cta.url}>
                  <a
                    className={i === 0 ? 'sh-btn sh-btn--primary' : 'sh-btn'}
                    href={hrefFor(cta.url, input)}
                  >
                    <span className="sh-btn__ang" aria-hidden="true">
                      &lt;
                    </span>
                    <span className="sh-btn__label">{cta.label}</span>
                    {external(cta.url) ? <span aria-hidden="true">{' ↗'}</span> : null}
                    <span className="sh-btn__ang" aria-hidden="true">
                      &gt;
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {directories.length > 0 ? (
            <div className="sh-complete">
              <p aria-hidden="true">
                <Ps1 prompt={promptOf(input)} cwd="~" style={prompt} /> cd{' '}
                <span className="sh-faint">⇥</span>
              </p>
              <nav aria-label="Directories" lang={uiLang}>
                <ul>
                  {directories.map((destination) => (
                    <li key={destination.id}>
                      <a href={destination.href} lang={destination.lang}>
                        {cwdOf(destination.id, model).slice(2)}/
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
