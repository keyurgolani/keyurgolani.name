import type { VariantRenderInput } from '@portfolio/variant-contract';
import { uiLangOf } from '../parts';

// The palette's shell (brief §5.6 step 8): a native dialog with the
// combobox and its listbox, empty until the enhancement fills it from the
// index's links. Without a script it never opens, and the index is the way
// to every section.

export function PaletteDialog({ input, id }: { input: VariantRenderInput; id: string }) {
  const uiLang = uiLangOf(input);
  const title = `${id}-title`;
  const list = `${id}-list`;
  const count = `${id}-count`;
  return (
    <dialog className="sh-dlg" id={id} aria-labelledby={title} lang={uiLang} data-sh-dialog="">
      <p className="sh-dlg__hd">
        <b id={title}>Jump to</b>
        <button type="button" data-sh-close="">
          esc<span className="sh-sr"> to close</span>
        </button>
      </p>
      <div className="sh-q">
        <span className="sh-q__gt" aria-hidden="true">
          &gt;
        </span>
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={list}
          aria-autocomplete="list"
          aria-describedby={count}
          aria-label="Jump to a section, work, or link"
          placeholder="type to jump"
          autoComplete="off"
          spellCheck={false}
          data-sh-query=""
        />
        <span className="sh-q__cnt" id={count} aria-live="polite" data-sh-count-live="" />
      </div>
      <div className="sh-dlg__list" role="listbox" id={list} aria-label="Matches" data-sh-list="" />
    </dialog>
  );
}
