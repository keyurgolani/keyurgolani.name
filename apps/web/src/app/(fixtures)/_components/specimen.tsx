import type { ReactNode } from 'react';
import {
  boundaryId,
  partId,
  STATUSES,
  SURFACE_EMPHASES,
  type BoundaryIds,
} from '@portfolio/appearance';
import {
  Action,
  Badge,
  Checkbox,
  DataDisplay,
  Dialog,
  Disclosure,
  Field,
  Main,
  Media,
  Navigation,
  Radio,
  Region,
  Select,
  Surface,
  Tabs,
  Toast,
  ToastRegion,
  Tooltip,
  type DataRow,
} from '@portfolio/appearance/primitives';
import { FormHarness } from './form-harness';
import { ToastHarness } from './toast-harness';

// The scenes the appearance fixtures render (#19, Slice 3), after the
// reviewed prototype's specimen: every shared primitive in each of its
// states. Server components, with plain props only: the static primitives
// take their full ids from boundaryId(), and the client ones take local ids
// and add their boundary's prefix. Every id comes from the boundary's ids,
// so a plate's are its own.

const TYPE_SAMPLES = [
  ['display', 'Evidence should feel alive.'],
  ['headline', 'A shared language for uncertain systems'],
  ['title', 'Signal Atlas'],
  [
    'body',
    'A semantic interface can change its visual voice without changing what its controls mean or how its evidence is read.',
  ],
  ['body-compact', 'Compact context remains clear at the edge of a dense workspace.'],
  ['label', 'Observation status'],
  ['caption', 'Last reconciled 14:32 local time'],
  ['quote', 'Make the invisible negotiable.'],
  ['code', 'appearance.resolve({ mode: "system" })'],
  ['numeric', '12,048.72'],
] as const;

const STATUS_WORDS = {
  neutral: 'Draft',
  positive: 'Verified',
  warning: 'Review',
  danger: 'Blocked',
  information: 'Informational',
} as const;

const SOURCES = [
  ['field-survey', 'Field survey', 68, 'positive'],
  ['satellite', 'Satellite pass', 47, 'warning'],
  ['archive', 'Archive record', 82, 'positive'],
  ['interview', 'Interview notes', 56, 'information'],
  ['sensor', 'Sensor feed', 73, 'positive'],
  ['estimate', 'Model estimate', 39, 'danger'],
] as const;

const COVERAGE = [
  ['north', 'North basin', 30],
  ['delta', 'Delta', 62],
  ['ridge', 'Ridge line', 88],
] as const;

/** An inline image, so the page loads nothing from anywhere else. */
const MAP_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="#d9d4c7"/><path d="M0 70 C40 40 80 90 160 50 L160 100 L0 100 Z" fill="#8a9a7b"/><circle cx="118" cy="28" r="10" fill="#c9a24b"/></svg>',
)}`;

/** A decorative arrow for the icon slots, drawn in the text's color. */
function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16">
      <path d="M4 12 12 4M6 4h6v6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function sourceRows(): DataRow[] {
  return SOURCES.map(([key, label, confidence, status]) => ({
    key,
    status,
    cells: {
      source: label,
      status: STATUS_WORDS[status],
      confidence: `${confidence}%`,
    },
  }));
}

/** Every primitive in each of its states, in the page's document boundary, then `children`. */
export function DocumentSpecimen({
  ids,
  children,
}: {
  readonly ids: BoundaryIds;
  readonly children?: ReactNode;
}) {
  const id = (local: string) => boundaryId(ids, local);
  return (
    <Main id={ids.main} className="fixtures-page">
      <Region labelledBy={id('actions-title')} className="fixtures-section" id={id('actions')}>
        <h2 id={id('actions-title')} data-type-role="headline">
          Actions
        </h2>
        <div className="fixtures-row" data-fixture="actions">
          <Action emphasis="primary">Publish revision</Action>
          <Action>Save draft</Action>
          <Action icon={<Arrow />}>Open the map</Action>
          <Action emphasis="quiet">Dismiss</Action>
          <Action pressed>Selected</Action>
          <Action pressed={false}>Not selected</Action>
          <Action loading>Validating</Action>
          <Action disabled>Unavailable</Action>
          <Action href={`#${id('forms')}`}>Go to the forms</Action>
          <Action href={`#${id('forms')}`} disabled>
            Archived link
          </Action>
          <Action href={`#${id('forms')}`} loading>
            Fetching the forms
          </Action>
        </div>
        <form className="fixtures-row" action="/_fixtures/appearance" method="get">
          <input type="hidden" name="submitted" value="1" />
          <Action type="submit" emphasis="primary" loading>
            Saving the revision
          </Action>
        </form>
      </Region>

      <Region labelledBy={id('forms-title')} className="fixtures-section" id={id('forms')}>
        <h2 id={id('forms-title')} data-type-role="headline">
          Forms
        </h2>
        <div className="fixtures-grid">
          <div className="fixtures-stack">
            <Field
              id={id('title')}
              label="Revision title"
              description="Name the visible outcome, not the implementation."
              defaultValue="Signal Atlas, second pass"
            />
            <Field
              id={id('note')}
              label="Revision note"
              description="What a reader notices first."
              defaultValue="Improve the system"
              error="Add the user-facing outcome before validation can continue."
            />
            <Field id={id('reviewer')} label="Reviewer" type="email" required autoComplete="off" />
            <Field id={id('summary')} label="Summary" multiline rows={3} />
            <Field id={id('locked')} label="Revision number" defaultValue="18" disabled />
          </div>
          <div className="fixtures-stack">
            <Checkbox
              id={id('include-states')}
              label="Include interaction states"
              description="Hover, focus, pressed, and loading."
              defaultChecked
            />
            <Checkbox id={id('include-print')} label="Include print" />
            <Checkbox id={id('include-archive')} label="Include the archive" disabled />
            <Radio
              id={id('density')}
              name={id('density')}
              legend="Review depth"
              description="How much of each scene to show."
              defaultValue="comfortable"
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
                { value: 'dense', label: 'Dense', unavailable: 'Needs a wider screen.' },
              ]}
            />
            <Select
              id="basin"
              label="Basin"
              description="Grouped by how settled each one is."
              defaultValue="delta"
              groups={[
                {
                  label: 'Surveyed',
                  choices: [
                    { value: 'north', label: 'North basin' },
                    { value: 'delta', label: 'Delta' },
                  ],
                },
                {
                  label: 'Planned',
                  choices: [
                    { value: 'ridge', label: 'Ridge line' },
                    { value: 'shelf', label: 'Outer shelf', unavailable: 'not surveyed yet' },
                  ],
                },
              ]}
            />
            <Select
              id="season"
              label="Season"
              error="Pick the season the survey ran in."
              groups={[
                {
                  choices: [
                    { value: '', label: 'Choose a season' },
                    { value: 'wet', label: 'Wet' },
                    { value: 'dry', label: 'Dry' },
                  ],
                },
              ]}
            />
          </div>
          <FormHarness />
        </div>
      </Region>

      <Region labelledBy={id('status-title')} className="fixtures-section" id={id('status')}>
        <h2 id={id('status-title')} data-type-role="headline">
          Status and surfaces
        </h2>
        <div className="fixtures-row">
          {STATUSES.map((status) => (
            <Badge key={status} status={status}>
              {STATUS_WORDS[status]}
            </Badge>
          ))}
          <Badge status="positive" icon={<Arrow />}>
            Rising
          </Badge>
        </div>
        <div className="fixtures-grid">
          {SURFACE_EMPHASES.map((emphasis) => (
            <Surface key={emphasis} emphasis={emphasis} id={id(`surface-${emphasis}`)}>
              <p data-type-role="label">{emphasis} surface</p>
              <p data-type-role="caption">Materials and depth come from the language.</p>
            </Surface>
          ))}
        </div>
        <div className="fixtures-grid">
          <Disclosure summary="Why this status changed" id={id('why')}>
            <p data-type-role="body-compact">
              Three sources converged after the latest field record was reconciled.
            </p>
          </Disclosure>
          <Disclosure summary="What changed since the last revision" open id={id('changes')}>
            <p data-type-role="body-compact">The delta survey replaced the model estimate.</p>
          </Disclosure>
        </div>
        <div className="fixtures-stack">
          <Toast status="information" id={id('saved')}>
            Draft saved locally. Nothing was published.
          </Toast>
          <Toast status="warning" id={id('conflict')} actions={<Action>Review</Action>}>
            Another draft changed the same section.
          </Toast>
        </div>
      </Region>

      <Region labelledBy={id('overlays-title')} className="fixtures-section" id={id('overlays')}>
        <h2 id={id('overlays-title')} data-type-role="headline">
          Tabs, dialog, tooltip, and toasts
        </h2>
        <Tabs
          id="evidence-views"
          label="Evidence views"
          headingLevel={3}
          items={[
            {
              id: 'summary',
              label: 'Summary',
              content: <p data-type-role="body">Six sources, four of them verified.</p>,
            },
            {
              id: 'activity',
              label: 'Activity',
              content: <p data-type-role="body">The archive record was reconciled today.</p>,
            },
            {
              id: 'sources',
              label: 'Sources',
              content: <p data-type-role="body">Field survey, satellite pass, and four more.</p>,
            },
          ]}
        />
        <div className="fixtures-row">
          <Tooltip id="confidence" content="Confidence combines recency, agreement, and coverage.">
            Explain confidence
          </Tooltip>
          <Dialog
            id="decision"
            trigger="Open decision note"
            title="Decision note"
            description="Why the basin's status moved to verified."
            closeLabel="Close decision note"
          >
            <p data-type-role="body-compact">Three sources agree, and none is older than a week.</p>
            <Field id={id('decision-reply')} label="Reply" />
          </Dialog>
        </div>
        <ToastRegion id="toasts">
          <ToastHarness />
        </ToastRegion>
      </Region>

      <Region labelledBy={id('media-title')} className="fixtures-section" id={id('media')}>
        <h2 id={id('media-title')} data-type-role="headline">
          Media and data
        </h2>
        <div className="fixtures-grid">
          <Media
            src={MAP_IMAGE}
            alt="A hill line over a valley, with the sun high on the right"
            width={160}
            height={100}
            caption="The delta survey's field map"
            id={id('map')}
          />
          <Media alt="Map of the north basin, not loaded yet" caption="Awaiting the scan" />
        </div>
        <DataDisplay
          id={id('sources')}
          caption="Confidence by source"
          columns={[
            { key: 'source', label: 'Source' },
            { key: 'status', label: 'Status' },
            { key: 'confidence', label: 'Confidence', numeric: true, sort: 'descending' },
          ]}
          rows={sourceRows()}
          bars={{
            column: 'confidence',
            max: 100,
            encoding: 'categorical',
            values: Object.fromEntries(SOURCES.map(([key, , value]) => [key, value])),
          }}
        />
        <DataDisplay
          id={id('coverage')}
          caption="Coverage by basin"
          columns={[
            { key: 'basin', label: 'Basin' },
            { key: 'coverage', label: 'Coverage', numeric: true },
          ]}
          rows={COVERAGE.map(([key, label, value]) => ({
            key,
            cells: { basin: label, coverage: `${value}%` },
          }))}
          bars={{
            column: 'coverage',
            max: 100,
            encoding: 'sequential',
            values: Object.fromEntries(COVERAGE.map(([key, , value]) => [key, value])),
          }}
        />
      </Region>

      <Region labelledBy={id('type-title')} className="fixtures-section" id={id('type')}>
        <h2 id={id('type-title')} data-type-role="headline">
          Type roles
        </h2>
        {TYPE_SAMPLES.map(([role, sample]) => (
          <p key={role} data-type-role={role}>
            {role === 'code' ? <code>{sample}</code> : sample}
          </p>
        ))}
      </Region>
      {children}
    </Main>
  );
}

/**
 * A plate's scene: the primitives a selection changes most, each with its
 * client half where it has one, so a test can see a plate attach nothing.
 */
export function PlateSpecimen({ ids }: { readonly ids: BoundaryIds }) {
  const id = (local: string) => boundaryId(ids, local);
  return (
    <Main id={ids.main} className="fixtures-page">
      <Navigation
        label="Plate"
        items={[
          { href: `#${id('scene')}`, label: 'Scene', current: 'location' },
          { href: `#${id('evidence')}`, label: 'Evidence' },
        ]}
      />
      <Surface emphasis="prominent" id={id('scene')}>
        <h2 data-type-role="title">Signal Atlas</h2>
        <p data-type-role="body-compact">One scene in another selection.</p>
        <div className="fixtures-row">
          {(['positive', 'warning', 'danger'] as const).map((status) => (
            <Badge key={status} status={status}>
              {STATUS_WORDS[status]}
            </Badge>
          ))}
        </div>
      </Surface>
      <div className="fixtures-row">
        <Action emphasis="primary">Publish revision</Action>
        <Action pressed>Selected</Action>
        <Action loading>Validating</Action>
        <Action disabled>Unavailable</Action>
      </div>
      <Field
        id={id('note')}
        label="Revision note"
        defaultValue="Improve the system"
        error="Add the user-facing outcome."
      />
      <Radio
        id={id('density')}
        name={id('density')}
        legend="Review depth"
        defaultValue="compact"
        orientation="horizontal"
        options={[
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
        ]}
      />
      <Select
        id="basin"
        label="Basin"
        defaultValue="north"
        groups={[
          {
            choices: [
              { value: 'north', label: 'North basin' },
              { value: 'shelf', label: 'Outer shelf', unavailable: 'not surveyed yet' },
            ],
          },
        ]}
      />
      <Tabs
        id="evidence-views"
        label="Evidence views"
        items={[
          { id: 'summary', label: 'Summary', content: <p>Six sources.</p> },
          { id: 'activity', label: 'Activity', content: <p>Reconciled today.</p> },
        ]}
      />
      <div className="fixtures-row">
        <Tooltip id="confidence" content="Confidence combines recency and agreement.">
          Explain confidence
        </Tooltip>
        <Dialog id="decision" trigger="Open decision note" title="Decision note">
          <p>Three sources agree.</p>
        </Dialog>
      </div>
      <ToastRegion id="toasts" />
      <FormHarness />
      <DataDisplay
        id={id('evidence')}
        caption="Confidence by source"
        columns={[
          { key: 'source', label: 'Source' },
          { key: 'confidence', label: 'Confidence', numeric: true },
        ]}
        rows={SOURCES.slice(0, 3).map(([key, label, value]) => ({
          key,
          cells: { source: label, confidence: `${value}%` },
        }))}
        bars={{
          column: 'confidence',
          max: 100,
          encoding: 'categorical',
          values: Object.fromEntries(SOURCES.map(([key, , value]) => [key, value])),
        }}
      />
      <p data-type-role="caption" id={partId(id('scene'), 'note')}>
        A plate is inert and still: nothing in it takes focus, moves, or listens.
      </p>
    </Main>
  );
}
