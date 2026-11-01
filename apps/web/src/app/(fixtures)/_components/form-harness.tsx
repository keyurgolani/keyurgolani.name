'use client';

import { useEffect, useState } from 'react';
import { Action, Checkbox, Field, Radio, Select } from '@portfolio/appearance/primitives';
import { useBoundary, useBoundaryId } from '@portfolio/appearance/react';

// The appearance fixtures' live form (#19, Slice 3): a Field, Checkbox,
// Radio, Select, and Action, each given a handler, and a submit button whose
// loading comes and goes, so a test can see it keep its element and its
// focus. In the page's boundary they answer; in a plate none of them
// attaches its handler, which tests/appearance checks on every element
// there. Its names contain no name the specs find the forms section's other
// controls by.

/** How long the live save shows as loading. */
const SAVE_MS = 600;

const DEPTHS = [
  { value: 'airy', label: 'Airy' },
  { value: 'snug', label: 'Snug' },
];

export function FormHarness() {
  const [note, setNote] = useState('');
  const [tracked, setTracked] = useState(true);
  const [depth, setDepth] = useState('snug');
  const [river, setRiver] = useState('north');
  const noteId = useBoundaryId('live-note');
  const trackId = useBoundaryId('live-track');
  const depthId = useBoundaryId('live-depth');
  const { plate } = useBoundary();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!saving) return;
    const timer = window.setTimeout(() => setSaving(false), SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [saving]);
  return (
    <div className="fixtures-stack" data-fixture="live-form">
      <Field
        id={noteId}
        label="Live note"
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
      <Checkbox
        id={trackId}
        label="Track the note"
        checked={tracked}
        onChange={(event) => setTracked(event.currentTarget.checked)}
      />
      <Radio
        id={depthId}
        name={depthId}
        legend="Live depth"
        options={DEPTHS}
        value={depth}
        onChange={setDepth}
        orientation="horizontal"
      />
      <Select
        id="live-river"
        label="Live river"
        value={river}
        onChange={setRiver}
        groups={[
          {
            choices: [
              { value: 'north', label: 'North fork' },
              { value: 'delta', label: 'Delta' },
            ],
          },
        ]}
      />
      <Action onClick={() => setNote('')}>Clear the note</Action>
      <form
        data-fixture="live-save"
        onSubmit={
          plate
            ? undefined
            : (event) => {
                event.preventDefault();
                setSaving(true);
              }
        }
      >
        <Action type="submit" loading={saving}>
          Save the live note
        </Action>
      </form>
      <p data-type-role="caption" data-fixture="live-form-state">
        {`${note || 'No note'}, ${tracked ? 'tracked' : 'not tracked'}, ${depth}, ${river}`}
      </p>
    </div>
  );
}
