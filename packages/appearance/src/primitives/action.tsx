import { ClientAction } from './action-client';
import { actionElement, type ActionProps } from './action-markup';

// Action (#19, Slice 3, item 2): a native button, or a link when it
// navigates (action-markup.tsx). It renders on the server and in client
// components alike. A submit or reset button, and an action given onClick,
// render through action-client.tsx, which reads its boundary and attaches
// nothing in a plate. Which half renders never depends on loading, so a
// button whose loading flips stays the same element and keeps its focus. A
// caller that has something to do on a click only some of the time passes
// one handler for the action's whole life and decides inside it. Only a
// client component can pass onClick, so a link or a plain button a server
// component renders stays markup alone.

export type { ActionProps } from './action-markup';

export function Action(props: ActionProps) {
  const submits = props.href === undefined && (props.type ?? 'button') !== 'button';
  if (props.onClick || submits) return <ClientAction {...props} />;
  return actionElement(props);
}
