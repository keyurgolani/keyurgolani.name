import type { ChangeEvent, ReactNode } from 'react';
import { partId } from '../ids';

// The markup of Field, Checkbox, and Radio (#19, Slice 3, item 2): native
// form controls, labelled, described, and validated through the platform's
// own semantics. An error sets aria-invalid and joins the description in
// aria-describedby; an option that isn't available is disabled, and a
// radio's reason is text its input names in aria-describedby. Each takes its
// full id, which server code builds with boundaryId(input.ids, local), and
// names its parts from it, so ids in a plate carry the plate's prefix.
// form.tsx renders them, and form-client.tsx does when one has a handler.

/** The ids of a control's description and error, those it has, for aria-describedby. */
function describedBy(id: string, description: unknown, error: unknown): string | undefined {
  const ids = [
    description ? partId(id, 'description') : null,
    error ? partId(id, 'error') : null,
  ].filter((value): value is string => value !== null);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export interface FieldProps {
  /** The control's id, from boundaryId(input.ids, local). */
  readonly id: string;
  readonly label: ReactNode;
  readonly name?: string;
  /** A one-line input's type. */
  readonly type?: 'text' | 'email' | 'url' | 'search' | 'tel' | 'password' | 'number';
  /** A text area in place of one line. */
  readonly multiline?: boolean;
  readonly rows?: number;
  readonly defaultValue?: string;
  /** With onChange, from a client component. */
  readonly value?: string;
  /** From a client component. In a plate it never goes on. */
  readonly onChange?: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly placeholder?: string;
  /** Help that stays: what to enter. */
  readonly description?: ReactNode;
  /** What's wrong with the value. Set, the control is invalid. */
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly autoComplete?: string;
  readonly className?: string;
}

/** A Field's element, with the handler its props give. */
export function fieldElement({
  id,
  label,
  name,
  type = 'text',
  multiline = false,
  rows,
  defaultValue,
  value,
  onChange,
  placeholder,
  description,
  error,
  required,
  disabled,
  readOnly,
  autoComplete,
  className,
}: FieldProps) {
  const control = {
    id,
    name,
    placeholder,
    required: required || undefined,
    disabled: disabled || undefined,
    readOnly: readOnly || undefined,
    autoComplete,
    defaultValue,
    value,
    onChange,
    'data-ui-slot': 'field.control',
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(id, description, error),
  };
  return (
    <div className={className} data-ui-slot="field">
      <label data-ui-slot="field.label" htmlFor={id}>
        {label}
      </label>
      {multiline ? <textarea {...control} rows={rows} /> : <input {...control} type={type} />}
      {description ? (
        <p data-ui-slot="field.description" id={partId(id, 'description')}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p data-ui-slot="field.error" data-status="danger" id={partId(id, 'error')}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface CheckboxProps {
  /** The input's id, from boundaryId(input.ids, local). */
  readonly id: string;
  readonly label: ReactNode;
  readonly name?: string;
  readonly value?: string;
  readonly defaultChecked?: boolean;
  /** With onChange, from a client component. */
  readonly checked?: boolean;
  /** From a client component. In a plate it never goes on. */
  readonly onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly description?: ReactNode;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** A Checkbox's element, with the handler its props give. */
export function checkboxElement({
  id,
  label,
  name,
  value,
  defaultChecked,
  checked,
  onChange,
  description,
  required,
  disabled,
  className,
}: CheckboxProps) {
  return (
    <div className={className} data-ui-slot="checkbox">
      {/* The label around the input makes the whole row the hit area. */}
      <label data-ui-slot="checkbox.label">
        <input
          type="checkbox"
          data-ui-slot="checkbox.control"
          id={id}
          name={name}
          value={value}
          defaultChecked={defaultChecked}
          checked={checked}
          onChange={onChange}
          required={required || undefined}
          disabled={disabled || undefined}
          aria-describedby={describedBy(id, description, null)}
        />
        {label}
      </label>
      {description ? (
        <p data-ui-slot="checkbox.description" id={partId(id, 'description')}>
          {description}
        </p>
      ) : null}
    </div>
  );
}

/** One radio. */
export interface RadioOption {
  readonly value: string;
  readonly label: ReactNode;
  /** Why it can't be chosen now. Set, the radio is disabled and says so. */
  readonly unavailable?: string;
}

export interface RadioProps {
  /** The group's id, from boundaryId(input.ids, local). Each radio's id adds its index. */
  readonly id: string;
  readonly legend: ReactNode;
  /**
   * The group's name. Outside a form, radios of one name are one group
   * across the whole document, so give it boundaryId(input.ids, local) too,
   * and a plate's group stays its own.
   */
  readonly name: string;
  readonly options: readonly RadioOption[];
  readonly defaultValue?: string;
  /** With onChange, controlled, from a client component. */
  readonly value?: string;
  /**
   * Called with the radio a visitor picks, from a client component,
   * controlled or not. In a plate it never goes on.
   */
  readonly onChange?: (value: string) => void;
  readonly description?: ReactNode;
  readonly required?: boolean;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly className?: string;
}

/** A Radio's element, with the handler its props give. */
export function radioElement({
  id,
  legend,
  name,
  options,
  defaultValue,
  value,
  onChange,
  description,
  required,
  orientation = 'vertical',
  className,
}: RadioProps) {
  const controlled = value !== undefined && onChange !== undefined;
  return (
    <fieldset
      id={id}
      className={className}
      data-ui-slot="radio"
      data-orientation={orientation}
      aria-describedby={describedBy(id, description, null)}
    >
      <legend data-ui-slot="radio.legend">{legend}</legend>
      {description ? (
        <p data-ui-slot="radio.description" id={partId(id, 'description')}>
          {description}
        </p>
      ) : null}
      {options.map((option, index) => {
        const inputId = partId(id, `option-${index + 1}`);
        const reasonId = partId(id, `reason-${index + 1}`);
        const selected = (controlled ? value : (defaultValue ?? value)) === option.value;
        return (
          <div key={option.value} data-ui-slot="radio.option">
            <label data-ui-slot="radio.label">
              <input
                type="radio"
                data-ui-slot="radio.control"
                id={inputId}
                name={name}
                value={option.value}
                required={required || undefined}
                disabled={option.unavailable ? true : undefined}
                aria-describedby={option.unavailable ? reasonId : undefined}
                {...(controlled ? { checked: selected } : { defaultChecked: selected })}
                onChange={
                  onChange
                    ? (event: ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value)
                    : undefined
                }
              />
              {option.label}
            </label>
            {option.unavailable ? (
              <p data-ui-slot="radio.reason" id={reasonId}>
                {option.unavailable}
              </p>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
