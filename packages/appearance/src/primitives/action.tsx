import { ClientAction } from './action-client';
import { actionElement, type ActionProps } from './action-markup';

// Action (#19, Slice 3, item 2): a native button, or a link when it
// navigates (action-markup.tsx). It renders on the server and in client
// components alike. One that needs a click handler, because its caller
// passed onClick or because it's a submit button that's loading, renders
// through action-client.tsx, which reads its boundary and attaches nothing
// in a plate. Only a client component can pass onClick, so an action a
// server component renders stays markup alone unless it's loading.

export type { ActionProps } from './action-markup';

export function Action(props: ActionProps) {
  const submits = props.href === undefined && (props.type ?? 'button') !== 'button';
  if (props.onClick || (props.loading && submits)) return <ClientAction {...props} />;
  return actionElement(props);
}
