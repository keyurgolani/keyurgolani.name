'use client';

// The client half of Field, Checkbox, and Radio (#19, Slice 3, item 2): the
// one place they take a change handler. Each reads its boundary, and in a
// plate attaches none, whatever its caller passed. A controlled value there
// becomes the control's first value, as the server rendered it, so the
// control is a still preview and React has no handler to want.

import { useBoundary } from '../react/boundary-root';
import {
  checkboxElement,
  fieldElement,
  radioElement,
  type CheckboxProps,
  type FieldProps,
  type RadioProps,
} from './form-markup';

export function ClientField(props: FieldProps) {
  const { plate } = useBoundary();
  if (!plate) return fieldElement(props);
  const { value, defaultValue } = props;
  return fieldElement({
    ...props,
    onChange: undefined,
    value: undefined,
    defaultValue: value ?? defaultValue,
  });
}

export function ClientCheckbox(props: CheckboxProps) {
  const { plate } = useBoundary();
  if (!plate) return checkboxElement(props);
  const { checked, defaultChecked } = props;
  return checkboxElement({
    ...props,
    onChange: undefined,
    checked: undefined,
    defaultChecked: checked ?? defaultChecked,
  });
}

export function ClientRadio(props: RadioProps) {
  const { plate } = useBoundary();
  if (!plate) return radioElement(props);
  const { value, defaultValue } = props;
  return radioElement({
    ...props,
    onChange: undefined,
    value: undefined,
    defaultValue: value ?? defaultValue,
  });
}
