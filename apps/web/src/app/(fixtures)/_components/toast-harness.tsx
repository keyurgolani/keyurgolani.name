'use client';

import { Action, useToast } from '@portfolio/appearance/primitives';

// The appearance fixtures' toast triggers (#19, Slice 3): one toast that
// goes by itself, and one with an action, which never does. In a plate the
// region shows neither.

export function ToastHarness() {
  const toasts = useToast();
  return (
    <div className="fixtures-row">
      <Action
        onClick={() => {
          toasts.show({
            message: 'Draft saved locally. Nothing was published.',
            status: 'information',
            dismissAfter: 6000,
          });
        }}
      >
        Show a toast
      </Action>
      <Action
        onClick={() => {
          toasts.show({
            message: 'Revision 17 was archived.',
            status: 'warning',
            action: {
              label: 'Undo',
              onAction: () => {
                toasts.show({ message: 'Revision 17 is back.', status: 'positive' });
              },
            },
          });
        }}
      >
        Show a toast with an action
      </Action>
    </div>
  );
}
