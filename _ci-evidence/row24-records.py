"""Row 24's evidence branch, never merged: the 18 schematic complete print cells' records, read back
from what the run left, and printed to the job log. It's read-only and writes nothing.

    python3 -I _ci-evidence/row24-records.py <label> <reports/.../quality/results> <want cells> <want records>

For each cell (a results folder), it prints the number of records in quality-records.json, then each
record's check, rule and actual, and whether it carries an element. A folder without the file is
named, since a test that recorded nothing is a finding of its own. Then it prints the totals against
the wanted counts. It exits 0 either way: the run step's exit is the gate, and this only shows what
the run left.
"""

import json
import os
import sys


def main():
    label, results, want_cells, want_records = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    if not os.path.isdir(results):
        print(f'[{label}] no results folder at {results}')
        return 0
    cells = 0
    records = 0
    elementless = 0
    missing = []
    for name in sorted(os.listdir(results)):
        folder = os.path.join(results, name)
        if not os.path.isdir(folder) or '-print-' not in name:
            continue
        cells += 1
        path = os.path.join(folder, 'quality-records.json')
        if not os.path.isfile(path):
            missing.append(name)
            print(f'[{label}] {name}: no quality-records.json')
            continue
        with open(path, encoding='utf-8') as handle:
            rows = json.load(handle)
        records += len(rows)
        print(f'[{label}] {name}: {len(rows)} record(s)')
        for row in rows:
            has = 'element' in row and row['element'] not in (None, '', {})
            if not has:
                elementless += 1
            where = f"{row.get('route')} {row.get('viewport')} {row.get('tuple', {}).get('displayMode')}"
            print(f"[{label}]   {where} | {row.get('check')} | {row.get('rule')} | {row.get('actual')} | element: {'yes' if has else 'no'}")
    print(f'[{label}] cells {cells} (want {want_cells}), records {records} (want {want_records}), elementless {elementless}, without a records file {len(missing)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
