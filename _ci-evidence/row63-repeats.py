"""Row 63's evidence branch, never merged: the five repeats of aurora-glass's sentinel cell, read back
from what the run already left, and printed to the job log. Read-only: it writes nothing.

    python3 -I _ci-evidence/row63-repeats.py <the run step's log> <reports/quality/results>

Per repeat:
- its duration, against CELL_TIMEOUT_MS 240 s, from the list reporter's own line for it (Playwright
  prints s to 0.1 s under a minute and m to 0.1 min, 6 s, above). The five lines carry the same
  title, so they're paired with the results folders by when each folder's quality-records.json was
  written, the test's last write: paired by order, not by name, and said so.
- axe's incomplete color-contrast count, and its reasons, from that repeat's axe.json.
- the resample time, from that repeat's trace.zip when there is one: from the end of axe's last
  Evaluate of 0.5 s or more, before the sampler's first "Scroll into view", to Attach "axe.json"
  (run-cell.ts attaches it once the resample is done). The quality config keeps traces only on
  failure (trace: 'retain-on-failure'), so a repeat that passed has none, and its resample time
  can't be read from this run's artifacts; it says so and prints nothing in its place.
"""

import collections
import json
import os
import re
import sys
import zipfile

CAP_S = 240.0
LINE = re.compile(r'^\s+(✓|✘|-)\s+\d+\s+\[chromium [0-9a-f]+\] › (?:tests/quality/)?cells\.spec\.ts:\d+:\d+ › .*1440x900 default.*\(([\d.]+)(ms|s|m)\)\s*$')


def seconds(value, unit):
    return float(value) / 1000 if unit == 'ms' else float(value) * (60 if unit == 'm' else 1)


def durations(log):
    out = []
    with open(log, encoding='utf-8', errors='replace') as f:
        for raw in f:
            line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', raw.rstrip('\n'))
            m = LINE.match(line)
            if m:
                out.append((m.group(1), seconds(m.group(2), m.group(3)), m.group(2) + m.group(3)))
    return out


def axe_counts(path):
    if not os.path.isfile(path):
        return None, {}
    with open(path, encoding='utf-8') as f:
        a = json.load(f)
    nodes = [n for r in a.get('incomplete', []) if r.get('id') == 'color-contrast' for n in r.get('nodes', [])]
    reasons = collections.Counter()
    for n in nodes:
        for c in n.get('any', []):
            d = c.get('data')
            reasons[(d.get('messageKey') if isinstance(d, dict) else None) or 'none'] += 1
    return len(nodes), dict(reasons)


def resample(trace_zip):
    if not os.path.isfile(trace_zip):
        return None, 'no trace.zip: the repeat passed, and the config keeps traces only on failure'
    before, after, order = {}, {}, []
    with zipfile.ZipFile(trace_zip) as z:
        for name in z.namelist():
            if not name.endswith('.trace'):
                continue
            for raw in z.read(name).decode('utf-8', 'replace').splitlines():
                try:
                    e = json.loads(raw)
                except ValueError:
                    continue
                key = e.get('callId') or e.get('stepId')
                if e.get('type') == 'before' and key:
                    before[key] = e
                    order.append(key)
                elif e.get('type') == 'after' and key:
                    after[key] = e
    steps = []
    for key in order:
        b = before[key]
        start = b.get('startTime')
        end = after.get(key, {}).get('endTime')
        title = b.get('title') or b.get('apiName') or ''
        if start is not None:
            steps.append((start, end, title))
    steps.sort()
    attach = next((s for s in steps if s[2] == 'Attach "axe.json"'), None)
    if not attach:
        return None, 'the trace has no Attach "axe.json" step: the test ended before the resample did'
    scroll = next((s for s in steps if s[2].startswith('Scroll into view') and s[0] < attach[0]), None)
    limit = scroll[0] if scroll else attach[0]
    axe = [s for s in steps if s[2].startswith('Evaluate') and s[1] and s[1] - s[0] >= 500 and s[1] <= limit]
    if not axe:
        return None, "the trace has no Evaluate of 0.5 s or more before the sampler: axe's end can't be placed"
    return (attach[0] - axe[-1][1]) / 1000, 'from the trace'


def main():
    log, results = sys.argv[1], sys.argv[2]
    lines = durations(log)
    folders = sorted(
        os.path.join(results, d)
        for d in os.listdir(results) if os.path.isdir(results) and '1440x900-default' in d and 'aurora-g' in d
    ) if os.path.isdir(results) else []
    def written(folder):
        p = os.path.join(folder, 'quality-records.json')
        return os.path.getmtime(p) if os.path.isfile(p) else float('inf')
    folders.sort(key=written)
    print(f'[row63] {len(lines)} reporter line(s) for the cell, {len(folders)} results folder(s); want 5 and 5')
    print('[row63] durations are paired with folders by completion order (quality-records.json written), not by name')
    for i in range(max(len(lines), len(folders))):
        status, secs, shown = lines[i] if i < len(lines) else ('?', None, '?')
        folder = folders[i] if i < len(folders) else None
        n, reasons = axe_counts(os.path.join(folder, 'axe.json')) if folder else (None, {})
        rs, how = resample(os.path.join(folder, 'trace.zip')) if folder else (None, 'no folder')
        over = '' if secs is None else (' OVER the cap' if secs >= CAP_S else f' {CAP_S - secs:.0f} s under the cap')
        print(f'[row63] repeat {i + 1}: {status} {shown} (~{secs if secs is not None else "?"} s of {CAP_S:.0f} s){over}')
        print(f'[row63]   folder {os.path.basename(folder) if folder else "none"}')
        print(f'[row63]   axe incomplete color-contrast {n if n is not None else "no axe.json"}, reasons {reasons}')
        print(f'[row63]   resample {"%.1f s" % rs if rs is not None else "not readable"} ({how})')
    ok = len(lines) == 5 and len(folders) == 5
    print(f'[row63] {"five repeats read" if ok else "NOT five repeats: see the counts above"}')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
