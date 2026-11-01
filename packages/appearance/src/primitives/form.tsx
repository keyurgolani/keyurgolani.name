import { ClientCheckbox, ClientField, ClientRadio } from './form-client';
import type { CheckboxProps, FieldProps, RadioProps } from './form-markup';

// Field, Checkbox, and Radio (#19, Slice 3, item 2): native form controls
// (form-markup.tsx). They render on the server and in client components
// alike, always through form-client.tsx, which reads its boundary and
// attaches nothing in a plate. So a control is the same element for its
// whole life, whether or not its caller has a handler for it yet, and
// keeps its focus when the caller's handler comes or goes.

export type { CheckboxProps, FieldProps, RadioOption, RadioProps } from './form-markup';

export function Field(props: FieldProps) {
  return <ClientField {...props} />;
}

export function Checkbox(props: CheckboxProps) {
  return <ClientCheckbox {...props} />;
}

export function Radio(props: RadioProps) {
  return <ClientRadio {...props} />;
}
