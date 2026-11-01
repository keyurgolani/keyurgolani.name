import { footerOutline, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { controlsOf, promptOf } from '../model';
import { Ps1, uiLangOf, Words } from '../parts';

// The end of the session: a fresh prompt with a caret (the session is still
// open), the colophon, and the visitor's control. The caret blinks four
// times when it comes into view, then holds (the enhancement marks it live).

export function Footer({ input, cwd = '~' }: { input: VariantRenderInput; cwd?: string }) {
  const uiLang = uiLangOf(input);
  const footer = footerOutline(input);
  const { prompt } = controlsOf(input);
  const { colophon } = footer;
  return (
    <footer className="sh-end" data-sh-end="">
      <p className="sh-end__prompt" aria-hidden="true">
        <Ps1 prompt={promptOf(input)} cwd={cwd} style={prompt} /> <span className="sh-caret" />
      </p>
      <div className="sh-end__colo">
        {colophon.title ? (
          <p>
            <b>{colophon.title}</b>
          </p>
        ) : null}
        {colophon.description ? <p>{colophon.description}</p> : null}
        <p>
          © {footer.year} {footer.name}
        </p>
      </div>
      <div className="sh-end__slot">
        <span className="sh-faint" aria-hidden="true">
          <Words lang={uiLang}># preferences</Words>
        </span>
        <VisitorControlSlot />
      </div>
    </footer>
  );
}
