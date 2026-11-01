import type { PageOutline } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { present, squash, type Stop } from '../model';
import { uiLang, Words } from '../parts';
import { ContentsDialog } from './contents-dialog';

// The bar (brief §5.7, step 3; the report's "slim top bar, name left,
// Email right"): the name, Contents and Email, and nothing else (N1: on a
// phone, the name and Contents). It takes the ground of the panel under it
// once the pager runs, and the name docks into panel 1's h1 while that's
// on screen, so the name never shows twice. It's pinned chrome, so the
// platform holds its actions to 44 px (data-pinned).

export function Bar({
  input,
  outline,
  stops,
  short,
}: {
  input: VariantRenderInput;
  outline?: PageOutline;
  stops?: readonly Stop[];
  short?: string;
}) {
  const { identity, locale } = input.portfolio;
  const lang = uiLang(locale);
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const home =
    input.route.route === 'home' ? `#${input.ids.main}` : routeHref(input, { route: 'home' });
  return (
    <header className="sg-bar" data-ground="canvas" data-pinned="">
      <div className="sg-grid sg-bar__in">
        <a className="sg-bar__name" href={home} data-type-role="title">
          {squash(identity.name)}
        </a>
        <div className="sg-bar__nav" data-type-role="body">
          <ContentsDialog
            input={input}
            outline={outline}
            stops={stops}
            short={short}
            home={input.route.route === 'home' ? undefined : home}
          />
          {email ? (
            <a className="sg-bar__email" href={`mailto:${email}`}>
              <Words lang={lang}>Email</Words>
            </a>
          ) : null}
        </div>
      </div>
    </header>
  );
}
