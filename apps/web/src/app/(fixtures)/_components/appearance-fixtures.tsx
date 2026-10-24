import type { AppearanceSelection } from '@portfolio/schema';
import {
  AXIS_LABELS,
  axisFallback,
  createAppearanceRegistry,
  DEFAULT_VISITOR_CONTROLS,
  PACK_AXES,
  parseSelection,
  PLATFORM_DEFAULTS,
  registryStylesheets,
  resolveAppearance,
  visitorAppearanceModel,
  type AppearanceRegistry,
  type AppearanceStylesheets,
  type BoundaryAppearance,
  type Profile,
  type SelectionText,
} from '@portfolio/appearance';
import {
  DataDisplay,
  Header,
  Navigation,
  Region,
  type DataRow,
} from '@portfolio/appearance/primitives';
import { AppearanceDiagnostics, PresentationBoundary } from '@portfolio/appearance/react';
import { PACKS, PLATFORM_STYLESHEET, VARIANTS } from '~/lib/generated/registry.meta';
import { LiveAppearance } from './live-appearance';
import { DocumentSpecimen, PlateSpecimen } from './specimen';

// The appearance fixtures (#19, Slice 3): the page's document boundary,
// with every primitive state, and plates holding other selections, each
// resolved by resolveAppearance() from this build's registry, the fixture
// packs included. The query picks the document's selection by the demo's
// keys (language, scheme, type, mode), so a test can render the primitives
// in each language. The page renders no variant: the fallback composition
// is the only one a build like this has, so the variant axis's diagnostic,
// that it can't be selected, is expected here and left out.

const DOCUMENT_IDS = { prefix: '', main: 'main' } as const;
const RETURN_TO = '/_fixtures/appearance';

/** The page's sections, which its navigation lists. */
const SECTIONS = [
  ['actions', 'Actions'],
  ['forms', 'Forms'],
  ['status', 'Status and surfaces'],
  ['overlays', 'Tabs, dialog, tooltip, and toasts'],
  ['media', 'Media and data'],
  ['type', 'Type roles'],
  ['packs', 'Registered packs'],
  ['plates', 'Plates'],
] as const;

/** The plates, each another selection, and what its caption says about it. */
const PLATES: readonly {
  readonly selection: Partial<AppearanceSelection>;
  readonly caption: string;
}[] = [
  {
    selection: { colorScheme: 'fixture-dark-only', displayMode: 'light' },
    caption: 'Fixture Dark Only, asked for light: it has no light mode, so it renders dark.',
  },
  {
    selection: { colorScheme: 'fixture-light-only' },
    caption: 'Fixture Light Only in system mode, which it locks to light.',
  },
  {
    selection: { designLanguage: 'fixture-translucent', displayMode: 'dark' },
    caption: 'Fixture Translucent, whose surfaces blur what is behind them, in dark mode.',
  },
  {
    selection: { designLanguage: 'platform-neutral', displayMode: 'high-contrast' },
    caption: 'Platform Neutral in high contrast.',
  },
  {
    selection: { typography: 'fixture-font', displayMode: 'dark' },
    caption: 'Fixture Font, a typography profile with a font of its own, in dark mode.',
  },
];

function resolve(
  registry: AppearanceRegistry,
  profile: Profile,
  selection: Partial<AppearanceSelection>,
): BoundaryAppearance {
  const resolved = resolveAppearance({
    published: {
      ...PLATFORM_DEFAULTS,
      ...selection,
      variant: axisFallback('variant'),
    },
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    profile,
    registry,
  });
  return {
    ...resolved,
    diagnostics: resolved.diagnostics.filter((diagnostic) => diagnostic.axis !== 'variant'),
  };
}

export interface AppearanceFixturesProps {
  readonly profile: Profile;
  /** The page's query, which may pick the document's selection. */
  readonly query: SelectionText;
}

/** Every pack this build registers, by axis: what a test may render the page in. */
function packRows(registry: AppearanceRegistry): DataRow[] {
  return PACK_AXES.flatMap((axis) =>
    [...registry.packs[axis].values()].map(({ manifest }) => ({
      key: `${axis}-${manifest.id}`,
      cells: { pack: manifest.name, axis: AXIS_LABELS[axis], id: manifest.id, tier: manifest.tier },
    })),
  );
}

/** The document's selection from the query: any of the four pack and mode axes it names well. */
function askedFor(query: SelectionText): Partial<AppearanceSelection> {
  const { designLanguage, colorScheme, typography, displayMode } = parseSelection(query);
  return {
    ...(designLanguage === undefined ? {} : { designLanguage }),
    ...(colorScheme === undefined ? {} : { colorScheme }),
    ...(typography === undefined ? {} : { typography }),
    ...(displayMode === undefined ? {} : { displayMode }),
  };
}

export function AppearanceFixtures({ profile, query }: AppearanceFixturesProps) {
  const registry = createAppearanceRegistry({ VARIANTS, PACKS, PLATFORM_STYLESHEET });
  const stylesheets: AppearanceStylesheets = registryStylesheets(registry);
  const page = resolve(registry, profile, askedFor(query));
  const model = visitorAppearanceModel({
    registry,
    appearance: page,
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    profile,
  });
  return (
    <PresentationBoundary
      kind="document"
      appearance={page}
      ids={DOCUMENT_IDS}
      stylesheets={stylesheets}
      skipLink={{ label: 'Skip to the fixtures' }}
    >
      <Header className="fixtures-page">
        <h1 data-type-role="display">Appearance fixtures</h1>
        <p data-type-role="body">
          Every shared primitive in each of its states, then plates that hold other selections.
        </p>
        <Navigation
          label="Fixture sections"
          items={SECTIONS.map(([id, label], index) => ({
            href: `#${id}`,
            label,
            current: index === 0 ? 'location' : undefined,
          }))}
        />
        <AppearanceDiagnostics diagnostics={page.diagnostics} id="page-diagnostics" />
        <LiveAppearance model={model} returnTo={RETURN_TO} />
      </Header>
      <DocumentSpecimen ids={DOCUMENT_IDS}>
        <Region labelledBy="packs-title" className="fixtures-section" id="packs">
          <h2 id="packs-title" data-type-role="headline">
            Registered packs
          </h2>
          <DataDisplay
            id="packs-table"
            caption="What this build registers, by axis"
            columns={[
              { key: 'pack', label: 'Pack' },
              { key: 'axis', label: 'Axis' },
              { key: 'id', label: 'Id' },
              { key: 'tier', label: 'Tier' },
            ]}
            rows={packRows(registry)}
          />
        </Region>
        <Region labelledBy="plates-title" className="fixtures-section" id="plates">
          <h2 id="plates-title" data-type-role="headline">
            Plates
          </h2>
          <div className="fixtures-plates">
            {PLATES.map(({ selection, caption }, index) => {
              const number = index + 1;
              const ids = { prefix: `plate-${number}-`, main: `plate-${number}-main` };
              const appearance = resolve(registry, profile, selection);
              return (
                <figure key={number} className="fixtures-plate" data-fixture-plate={number}>
                  <figcaption data-type-role="label">{caption}</figcaption>
                  <PresentationBoundary
                    kind="plate"
                    appearance={appearance}
                    ids={ids}
                    stylesheets={stylesheets}
                  >
                    <PlateSpecimen ids={ids} />
                  </PresentationBoundary>
                  <AppearanceDiagnostics
                    diagnostics={appearance.diagnostics}
                    label={`Plate ${number} diagnostics`}
                    id={`diagnostics-${number}`}
                  />
                </figure>
              );
            })}
          </div>
        </Region>
      </DocumentSpecimen>
    </PresentationBoundary>
  );
}
