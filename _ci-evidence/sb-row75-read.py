# Row 75's evidence only, never merged: Spatial Bento's nine cells at 1440x900 default on
# platform-neutral/warm-parchment/humanist-ui, read back from the job's summary.json, each with its
# status, its reflow root-text "@1024x768 html" failure if any (the records' failure), and every other
# failure listed. It fails only when the summary doesn't hold exactly those nine cells once each: the
# reds themselves are the evidence, read by the lead, never judged here.
#   python3 -I sb-row75-read.py <reports quality dir> <listed count>
import json, os, sys
quality, listed = sys.argv[1], sys.argv[2]
P = 'composition:spatial-bento '
CELLS = [f'{P}{c} / spatial-bento/platform-neutral/warm-parchment/humanist-ui/{m}'
         for c in ('complete', 'missing-media', 'sparse') for m in ('light', 'dark', 'system')]
tests = json.load(open(os.path.join(quality, 'summary.json')))['tests']
cells = [t for t in tests if t.get('kind') == 'cell' and t.get('viewport') == '1440x900'
         and t.get('row') == 'default' and t.get('engine') == 'chromium']
bad = []
print(f'[row75] listed {listed}; the summary holds {len(cells)} such cell test(s)')
for cell in CELLS:
    found = [t for t in cells if t['cell'] == cell]
    if len(found) != 1:
        bad.append(f'{cell}: {len(found)} in the summary, not 1'); continue
    t = found[0]
    fails = t.get('failures', [])
    record = [f for f in fails if f.get('check') == 'reflow' and f.get('rule') == 'root-text' and f.get('target') == '@1024x768 html']
    other = [(f.get('check'), f.get('rule'), f.get('target')) for f in fails if f not in record]
    print(f"[row75] {cell[len(P):]:78} {t['status']:8} reflow-root-text={'yes' if record else 'no'} other={other} checks={len(t.get('checks', []))}/{len(t.get('owed', []))}")
extra = sorted({t['cell'] for t in cells} - set(CELLS))
if extra: print(f'[row75] (other 1440x900 default cells in the summary, not judged: {len(extra)})')
for line in bad: print(f'[row75] FAIL: {line}')
sys.exit(1 if bad else 0)
