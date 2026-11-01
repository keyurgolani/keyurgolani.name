// The skip link (#19, Slice 3, item 1): the first thing a document boundary
// renders, a link to the variant's one main, out of sight until it has
// focus. It replaces #5's host skip link once Slice 4 renders the boundary.
// Plates render none.

export interface SkipLinkProps {
  /** The main's id: the render input's ids.main. */
  readonly target: string;
  readonly label?: string;
  /** The link's language, when the portfolio's isn't the language of the label. */
  readonly lang?: string;
}

export function SkipLink({ target, label = 'Skip to content', lang }: SkipLinkProps) {
  return (
    <a data-ui-slot="skip-link" href={`#${target}`} lang={lang}>
      {label}
    </a>
  );
}
