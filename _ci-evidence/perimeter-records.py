"""Main's red on 6c246c594 (run 42349001278), the evidence branch, never merged: the focus records of
aurora-glass's ten change-directed cells, read back from one run's results folders and printed to the
job log, and their key fields written as JSON for the lead to list. Read-only but for that one file.

    python3 -I _ci-evidence/perimeter-records.py <label> <quality/results dir> <cells wanted> <json out>

Per cell (each results folder of a 'default' aurora-glass cell), every focus record: its rule, its
element's selector, the points line (actual), and its uiSlot. Then the totals. The JSON is a list of
{side, cell, check, rule, selector, viewport, tuple, uiSlot, inputMode, actual}, one per focus record.
It exits 1 when the run left a number of cell folders other than the cells wanted, or one has no
quality-records.json; records themselves never fail it (the base may well have some).
"""

import json
import os
import sys

label, results, wanted, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
folders = sorted(
    d for d in (os.listdir(results) if os.path.isdir(results) else [])
    if 'aurora-g' in d and '-default-' in d and os.path.isdir(os.path.join(results, d))
)
rows = []
missing = []
for d in folders:
    path = os.path.join(results, d, 'quality-records.json')
    if not os.path.isfile(path):
        missing.append(d)
        print(f'[{label}] {d}: no quality-records.json')
        continue
    with open(path, encoding='utf-8') as f:
        records = json.load(f)
    focus = [r for r in records if r.get('check') == 'focus']
    first = records[0] if records else {}
    print(f'[{label}] {d}: {len(records)} record(s), {len(focus)} focus')
    for r in focus:
        el = r.get('element') or {}
        t = r.get('tuple') or {}
        tuple_ = '/'.join(str(t.get(k)) for k in ('designLanguage', 'colorScheme', 'typography', 'displayMode'))
        slot = r.get('uiSlot') or el.get('uiSlot')
        print(f"[{label}]   {r.get('rule')} {r.get('viewport')} {tuple_} {el.get('selector')!r}: "
              f"{r.get('actual')!r}, uiSlot {slot!r}")
        rows.append({
            'side': label,
            'cell': d,
            'check': r.get('check'),
            'rule': r.get('rule'),
            'selector': el.get('selector'),
            'viewport': r.get('viewport'),
            'tuple': tuple_,
            'uiSlot': slot,
            'inputMode': r.get('inputMode'),
            'actual': r.get('actual'),
        })
os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    json.dump(rows, f, indent=2)
perimeter = sum(1 for r in rows if r['rule'] == 'perimeter')
print(f'[{label}] {len(folders)} cell folder(s) of {wanted} wanted; {len(rows)} focus record(s), '
      f'{perimeter} perimeter; written to {out}')
sys.exit(0 if len(folders) == wanted and not missing else 1)
