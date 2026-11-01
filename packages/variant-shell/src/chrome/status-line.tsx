import type { NavigationModel } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { cwdOf, promptOf, slugOf } from '../model';
import { Sr, uiLangOf, Words } from '../parts';

// The status line (brief §5.6, the signature): a tmux bar on the bottom
// edge. The session name links home; the windows are the five
// destinations, the current one starred; on the right, the section
// counter, the scroll meter (CSS only), and the jump to the index, a link
// without a script and the palette's button with one.

/**
 * The session's first child: an empty mark inside <noscript>. The parser makes it an element
 * only when it reads the page with scripting off; with scripting on it's the noscript's text.
 * So the status line keys its in-flow layout on the mark (styles.css), not on a scripting
 * query: a visitor with JavaScript has the fixed bar from the first paint, whatever the
 * enhancement does, and nothing flips once the page has been read. No style goes in here:
 * the layout is all in styles.css.
 */
export function NoScriptMark() {
  return (
    <noscript>
      <i data-sh-nojs="" hidden />
    </noscript>
  );
}

export function StatusLine({
  input,
  model,
  total,
  indexHref,
  dialogId,
  cwd = '~',
}: {
  input: VariantRenderInput;
  model: NavigationModel;
  total: number;
  indexHref: string;
  dialogId: string;
  /** Where the session is before the scroll spy says: home's `~`, a case page's `~/work`. */
  cwd?: string;
}) {
  const uiLang = uiLangOf(input);
  const { user } = promptOf(input);
  const session = user ?? (slugOf(model.name.label) || '~');
  return (
    <nav
      className="sh-tmux"
      aria-label="Destinations"
      lang={uiLang}
      data-sh-tmux=""
      data-ui-surface="accent"
    >
      <a className="sh-tmux__sess" href={model.name.href} lang={input.portfolio.locale}>
        <span aria-hidden="true">[{session}]</span>
        <Sr>{model.name.label}</Sr>
      </a>
      {model.primary.length > 0 ? (
        <ul className="sh-tmux__wins">
          {model.primary.map((destination) => (
            <li key={destination.id}>
              <a
                className="sh-tmux__win"
                href={destination.href}
                data-dest={destination.id}
                lang={destination.lang}
              >
                <span aria-hidden="true">{cwdOf(destination.id, model)}</span>
                <Sr>{destination.label}</Sr>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <span className="sh-tmux__cur" aria-hidden="true" data-sh-cur={cwd}>
        {cwd}
      </span>
      <span className="sh-tmux__right">
        <span className="sh-tmux__pos" data-sh-count={total} aria-hidden="true">
          <Words lang={uiLang}>{`${total} sections`}</Words>
        </span>
        <span className="sh-tmux__meter" aria-hidden="true">
          <i />
        </span>
        <a className="sh-tmux__jump" href={indexHref} data-sh-jump-link="">
          jump
        </a>
        {/* The shortcut sits beside the button, not in it, so its name is the word it shows. */}
        <span className="sh-tmux__kb" aria-hidden="true" data-sh-keys="" hidden>
          ⌘K
        </span>
        <button
          className="sh-tmux__jump"
          type="button"
          aria-haspopup="dialog"
          aria-controls={dialogId}
          aria-keyshortcuts="Meta+K Control+K /"
          data-sh-jump=""
          hidden
        >
          jump
        </button>
      </span>
    </nav>
  );
}
