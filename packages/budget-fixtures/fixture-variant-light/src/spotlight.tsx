'use client';

import { useState, type ReactElement } from 'react';

// fixture-variant-light's one client island (#6, Slice 2): a toggle, a few
// hundred bytes of the variant's own code in the browser, which the trace
// finds by its source map on this variant's pages and on no other's.

export function Spotlight({ lang }: { readonly lang?: string }): ReactElement {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      className="fvl-spotlight"
      lang={lang}
      aria-pressed={on}
      onClick={() => setOn((value) => !value)}
    >
      Spotlight
    </button>
  );
}
