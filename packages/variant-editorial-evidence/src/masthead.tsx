import { VisitorControlSlot } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { homeRegion, regionId, Words } from './parts';

// The masthead (#13): the name, which always goes home, one navigation list
// of the page's destinations, and the visitor control. It stays in the
// page's flow: nothing is fixed, nothing hides on scroll, and the list wraps
// onto more lines on a narrow screen rather than scrolling sideways. Every
// destination is text, reachable without hover or motion, and the current
// page is marked. Links to the home page's regions work from a case study
// too, through the mount-aware route helper.

export interface Destination {
  readonly label: string;
  /** The region's id on the home page. */
  readonly id: string;
  /** The label's language, when it's the owner's words and not the composition's. */
  readonly lang?: string;
  /** Whether the label is the composition's own word, such as Work. */
  readonly ui?: boolean;
}

export function Masthead({
  input,
  destinations,
}: {
  input: VariantRenderInput;
  destinations: readonly Destination[];
}) {
  const home = routeHref(input, { route: 'home' });
  const atHome = input.route.route === 'home';
  const label = regionId(input, 'nav');
  return (
    <header className="ee-masthead">
      <a
        className="ee-masthead__name"
        href={home}
        data-type-role="label"
        aria-current={atHome ? 'page' : undefined}
      >
        {input.portfolio.identity.name}
      </a>
      {destinations.length > 0 ? (
        <nav className="ee-nav" aria-labelledby={label}>
          <span id={label} hidden>
            <Words input={input}>Sections</Words>
          </span>
          <ul role="list">
            {destinations.map((destination) => (
              <li key={destination.id}>
                <a
                  href={homeRegion(input, destination.id)}
                  lang={destination.ui ? undefined : destination.lang}
                  data-type-role="label"
                >
                  {destination.ui ? (
                    <Words input={input}>{destination.label}</Words>
                  ) : (
                    destination.label
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <VisitorControlSlot />
    </header>
  );
}
