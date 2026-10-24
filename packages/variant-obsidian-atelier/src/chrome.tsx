import { VisitorControlSlot } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { ownId, Words } from './parts';

// The chrome (#15): the name, which goes home, a link to the chapter index,
// and the visitor control. It stays in the page's flow: nothing is fixed,
// nothing hides on scroll, and nothing needs a script, a pointer, or hover.
// The index link is a plain fragment link, so the index is one Tab and one
// Enter away from the top of the page, and works with no JavaScript.

export function Chrome({ input, hasIndex }: { input: VariantRenderInput; hasIndex: boolean }) {
  return (
    <header className="oa-chrome">
      <a
        className="oa-chrome__name"
        href={routeHref(input, { route: 'home' })}
        data-type-role="label"
        aria-current="page"
      >
        {input.portfolio.identity.name}
      </a>
      {hasIndex ? (
        <a className="oa-chrome__index" href={`#${ownId(input, 'index')}`} data-type-role="label">
          <Words input={input}>Index</Words>
        </a>
      ) : null}
      <VisitorControlSlot />
    </header>
  );
}
