'use client';

// Select (#19, Slice 3, item 2): a native select, labelled, described, and
// validated like Field. Options come in groups, each an optgroup when it
// has a label; an option the current selection can't take is disabled, and
// its reason is part of its text, since an option can't be described any
// other way. It takes a local id and adds the boundary's prefix. In a plate
// it attaches no listener.

import { Fragment, type ChangeEvent, type ReactNode } from 'react';
import { useBoundary, useBoundaryId } from '../react/boundary-root';
import { partId } from '../ids';

export interface SelectChoice {
  readonly value: string;
  readonly label: string;
  /** Why it can't be chosen now, such as `no light mode`. Set, the option is disabled and says so. */
  readonly unavailable?: string;
}

export interface SelectGroup {
  /** The optgroup's label. Without one, the choices sit directly in the select. */
  readonly label?: string;
  readonly choices: readonly SelectChoice[];
}

export interface SelectProps {
  /** A local id, which the boundary's prefix starts. */
  readonly id: string;
  readonly label: ReactNode;
  readonly name?: string;
  readonly groups: readonly SelectGroup[];
  readonly defaultValue?: string;
  /** With onChange, controlled. */
  readonly value?: string;
  readonly onChange?: (value: string, event: ChangeEvent<HTMLSelectElement>) => void;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** An option's text: its label, then why it's unavailable. */
export function choiceText(choice: SelectChoice): string {
  return choice.unavailable ? `${choice.label} (${choice.unavailable})` : choice.label;
}

export function Select({
  id: local,
  label,
  name,
  groups,
  defaultValue,
  value,
  onChange,
  description,
  error,
  required,
  disabled,
  className,
}: SelectProps) {
  const id = useBoundaryId(local);
  const { plate } = useBoundary();
  const listens = Boolean(onChange) && !plate;
  const describedBy =
    [description ? partId(id, 'description') : null, error ? partId(id, 'error') : null]
      .filter(Boolean)
      .join(' ') || undefined;
  const options = (choices: readonly SelectChoice[]) =>
    choices.map((choice) => (
      <option
        key={choice.value}
        value={choice.value}
        disabled={choice.unavailable ? true : undefined}
      >
        {choiceText(choice)}
      </option>
    ));
  return (
    <div className={className} data-ui-slot="select">
      <label data-ui-slot="select.label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        data-ui-slot="select.control"
        required={required || undefined}
        disabled={disabled || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...(listens && value !== undefined
          ? {
              value,
              onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                onChange!(event.currentTarget.value, event),
            }
          : {
              defaultValue: value ?? defaultValue,
              onChange: listens
                ? (event: ChangeEvent<HTMLSelectElement>) =>
                    onChange!(event.currentTarget.value, event)
                : undefined,
            })}
      >
        {groups.map((group, index) =>
          group.label ? (
            <optgroup key={`${group.label}#${index}`} label={group.label}>
              {options(group.choices)}
            </optgroup>
          ) : (
            <Fragment key={`#${index}`}>{options(group.choices)}</Fragment>
          ),
        )}
      </select>
      {description ? (
        <p data-ui-slot="select.description" id={partId(id, 'description')}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p data-ui-slot="select.error" data-status="danger" id={partId(id, 'error')}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
