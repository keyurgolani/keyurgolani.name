import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Home } from './home';
import { WorkPage } from './work-page';

// Editorial Evidence (#13), the platform's default composition: a practice
// thesis and one signature artifact first, then flagship work on unequal
// plates, the proof strip, the owner's reading order, and the archive
// behind a disclosure, with a page of its own for each work with a slug.
//
// It renders from the render input alone, on the server: no client
// component, no effect, no fetch, no clock, and no motion, so a page with no
// JavaScript, a print, and a preview frame all read the same. Its color,
// type, materials, and timing are #19's tokens; its stylesheet owns only
// arrangement. Inside a catalog plate the host's boundary makes it inert.

export default function EditorialEvidence({ input }: { readonly input: VariantRenderInput }) {
  return input.route.route === 'work' ? (
    <WorkPage input={input} slug={input.route.slug} />
  ) : (
    <Home input={input} />
  );
}
