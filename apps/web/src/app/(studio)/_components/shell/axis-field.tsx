import { optionNote, type AppearanceCatalog, type CatalogAxis } from '~/lib/studio/appearance';

// One appearance axis's field (#8, shared with #9's Demo Studio): its label,
// its select over what the build offers, and what the chosen value means,
// or what renders in its place when the build doesn't offer it. The owner's
// Appearance workspace puts its visitor control beside it; Demo Studio puts
// a reset there. It reaches no backend.

export interface AxisFieldProps {
  readonly id: string;
  readonly axis: CatalogAxis;
  /** The field's label, as its page words it. */
  readonly label: string;
  readonly value: string;
  readonly catalog: AppearanceCatalog;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}

export function AxisField({ id, axis, label, value, catalog, disabled, onChange }: AxisFieldProps) {
  const note = optionNote(catalog, axis, value);
  const options = catalog.axes.find((each) => each.axis === axis)?.options ?? [];
  return (
    <>
      <label className="studio-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="studio-input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {note.option ? null : (
          <option value={value}>
            {value === '' ? 'Not set' : value}, not available in this build
          </option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
            {option.tier && option.tier !== 'stable' ? ` (${option.tier})` : ''}
          </option>
        ))}
      </select>
      <OptionFacts axis={axis} note={note} />
    </>
  );
}

function OptionFacts({ axis, note }: { axis: CatalogAxis; note: ReturnType<typeof optionNote> }) {
  if (!note.option) {
    return (
      <p className="studio-appearance__fact">
        This build doesn&apos;t offer it, so {note.fallback} shows in its place, and it blocks
        publishing.
      </p>
    );
  }
  const { description, tier, provenance, performance, access } = note.option;
  return (
    <dl className="studio-appearance__facts" data-axis={axis}>
      {description ? (
        <>
          <dt>About</dt>
          <dd>{description}</dd>
        </>
      ) : null}
      {tier ? (
        <>
          <dt>Tier</dt>
          <dd>{tier}</dd>
        </>
      ) : null}
      {provenance.length > 0 ? (
        <>
          <dt>Provenance</dt>
          <dd>{provenance.join('; ')}</dd>
        </>
      ) : null}
      {performance ? (
        <>
          <dt>Performance</dt>
          <dd>{performance}</dd>
        </>
      ) : null}
      {access ? (
        <>
          <dt>Access</dt>
          <dd>{access}</dd>
        </>
      ) : null}
    </dl>
  );
}
