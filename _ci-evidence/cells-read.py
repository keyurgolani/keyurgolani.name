# Evidence only, never merged: the two cells at 390x844 under more contrast, read back from the
# job's summary.json. Obsidian Atelier's missing-media / in dark and high contrast, each with its
# status, its focus perimeter failure on the chrome's name if any, and every other failure. It
# fails only when the summary doesn't hold exactly those two cells once each: the reds themselves
# are the evidence, never judged here.
#   python3 -I cells-read.py <reports quality dir> <listed count>
import json, os, sys
quality, listed = sys.argv[1], sys.argv[2]
OA = 'composition:obsidian-atelier missing-media / obsidian-atelier/platform-neutral/warm-parchment/humanist-ui/'
CELLS = [f'{OA}{mode}' for mode in ('dark', 'high-contrast')]
NAME = 'header:nth-child(2) > a:nth-child(2)'
tests = json.load(open(os.path.join(quality, 'summary.json')))['tests']
cells = [t for t in tests if t.get('kind') == 'cell' and t.get('viewport') == '390x844'
         and t.get('row') == 'contrast-more' and t.get('engine') == 'chromium']
bad = []
print(f'[cells] listed {listed}; the summary holds {len(cells)} such cell test(s)')
for cell in CELLS:
    found = [t for t in cells if t['cell'] == cell]
    if len(found) != 1:
        bad.append(f'{cell}: {len(found)} in the summary, not 1')
        continue
    t = found[0]
    fails = t.get('failures', [])
    record = [f for f in fails if f.get('check') == 'focus' and f.get('rule') == 'perimeter'
              and (f.get('target') or '').endswith(NAME)]
    other = [(f.get('check'), f.get('rule'), f.get('target')) for f in fails if f not in record]
    print(f"[cells] {cell[len('composition:'):]:110} {t['status']:8} name-perimeter={'yes' if record else 'no'} other={other} checks={len(t.get('checks', []))}/{len(t.get('owed', []))}")
extra = sorted({t['cell'] for t in cells} - set(CELLS))
if extra: print(f'[cells] (other 390x844 contrast-more cells in the summary, not judged: {len(extra)})')
for line in bad: print(f'[cells] FAIL: {line}')
sys.exit(1 if bad else 0)
