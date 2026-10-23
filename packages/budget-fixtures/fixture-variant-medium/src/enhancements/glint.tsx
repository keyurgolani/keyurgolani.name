'use client';

import type { ReactElement } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// fixture-variant-medium's one enhancement (#6, Slice 2): a mark the
// visible trigger loads once its slot is in view. The kit's <Enhancement>
// loads this module in the browser, never on the server, so the page reads
// the same without it.

export default function Glint({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'variant'>;
}): ReactElement {
  return <span className="fvm-glint" data-fvm-glint={input.variant} aria-hidden="true" />;
}
