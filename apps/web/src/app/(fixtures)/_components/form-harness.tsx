'use client';

import { useState } from 'react';
import { Action, Checkbox, Field, Radio, Select } from '@portfolio/appearance/primitives';
import { useBoundaryId } from '@portfolio/appearance/react';

// The appearance fixtures' live form (#19, Slice 3): a Field, Checkbox,
// Radio, Select, and Action, each given a handler. In the page's boundary
// they answer; in a plate none of them attaches its handler, which
// tests/appearance checks on every element there.

const DEPTHS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

export function FormHarness() {
  const [note, setNote] = useState('');
  const [tracked, setTracked] = useState(true);
  const [depth, setDepth] = useState('compact');
  const [basin, setBasin] = useState('north');
  const noteId = useBoundaryId('live-note');
  const trackId = useBoundaryId('live-track');
  const depthId = useBoundaryId('live-depth');
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
        id="live-basin"
        label="Live basin"
        value={basin}
        onChange={setBasin}
        groups={[
          {
            choices: [
              { value: 'north', label: 'North basin' },
              { value: 'delta', label: 'Delta' },
            ],
          },
        ]}
      />
      <Action onClick={() => setNote('')}>Clear the note</Action>
      <p data-type-role="caption" data-fixture="live-form-state">
        {`${note || 'No note'}, ${tracked ? 'tracked' : 'not tracked'}, ${depth}, ${basin}`}
      </p>
    </div>
  );
}
