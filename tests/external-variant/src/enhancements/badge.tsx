'use client';

import type { ReactElement } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// The reference variant's one enhancement (#5, Slice 6): a mark beside the
// navigation that says the page's scripts ran. The kit's <Enhancement> loads
// this module in the browser once the page has hydrated, never on the
// server, so the page reads the same without it.

export default function Badge({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'variant'>;
}): ReactElement {
  return (
    <span className="acme-badge" data-acme-badge={input.variant} aria-hidden="true">
      Enhanced
    </span>
  );
}
