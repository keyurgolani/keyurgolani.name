'use client';

import type { ReactElement } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// The environment fixture's one enhancement (#7, Slice 4): a mark that says
// the page's scripts ran. The kit's <Enhancement> loads it in the browser
// once the page has hydrated, unless the boundary's environment turns
// enhancements off, so the page reads the same without it.

export default function Mark({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'variant'>;
}): ReactElement {
  return (
    <span
      className="fe-enhanced"
      data-fixture-environment-enhanced={input.variant}
      aria-hidden="true"
    >
      Enhanced
    </span>
  );
}
