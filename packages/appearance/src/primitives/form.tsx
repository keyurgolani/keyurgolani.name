import { ClientCheckbox, ClientField, ClientRadio } from './form-client';
import {
  checkboxElement,
  fieldElement,
  radioElement,
  type CheckboxProps,
  type FieldProps,
  type RadioProps,
} from './form-markup';

// Field, Checkbox, and Radio (#19, Slice 3, item 2): native form controls
// (form-markup.tsx). They render on the server and in client components
// alike. One given onChange, which only a client component can pass,
// renders through form-client.tsx, which reads its boundary and attaches
// nothing in a plate.

export type { CheckboxProps, FieldProps, RadioOption, RadioProps } from './form-markup';

export function Field(props: FieldProps) {
  return props.onChange ? <ClientField {...props} /> : fieldElement(props);
}

export function Checkbox(props: CheckboxProps) {
  return props.onChange ? <ClientCheckbox {...props} /> : checkboxElement(props);
}

export function Radio(props: RadioProps) {
  return props.onChange ? <ClientRadio {...props} /> : radioElement(props);
}
