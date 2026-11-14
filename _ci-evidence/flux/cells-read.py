# Evidence only, never merged: the four cells at 1440x900 default, read back from the job's
# summary.json. Flux missing-media / in light, dark, system and high contrast, each with its
# status, its reflow failure on the dock's name tab at 320 if any, and every other failure. It
# fails only when the summary doesn't hold exactly those four cells once each: the reds themselves
# are the evidence, never judged here.
#   python3 -I cells-read.py <reports quality dir> <listed count>
import json, os, sys
quality, listed = sys.argv[1], sys.argv[2]
CELLS = [f'composition:flux missing-media / flux/platform-neutral/warm-parchment/humanist-ui/{m}'
         for m in ('light', 'dark', 'system', 'high-contrast')]
NAME = '@320x568 #fx--bar > div:nth-child(1) > nav:nth-child(1) > ul:nth-child(2) > li:nth-child(1) > a:nth-child(1) > span:nth-child(1)'
tests = json.load(open(os.path.join(quality, 'summary.json')))['tests']
cells = [t for t in tests if t.get('kind') == 'cell' and t.get('viewport') == '1440x900'
         and t.get('row') == 'default' and t.get('engine') == 'chromium']
bad = []
print(f'[cells] listed {listed}; the summary holds {len(cells)} such cell test(s)')
for cell in CELLS:
    found = [t for t in cells if t['cell'] == cell]
    if len(found) != 1:
        bad.append(f'{cell}: {len(found)} in the summary, not 1')
        continue
    t = found[0]
    fails = t.get('failures', [])
    name = [f for f in fails if f.get('check') == 'reflow' and f.get('target') == NAME]
    other = [(f.get('check'), f.get('rule'), f.get('target')) for f in fails if f not in name]
    print(f"[cells] {cell[len('composition:'):]:80} {t['status']:8} dock-name-reflow={'yes' if name else 'no'} other={other} checks={len(t.get('checks', []))}/{len(t.get('owed', []))}")
for line in bad: print(f'[cells] FAIL: {line}')
sys.exit(1 if bad else 0)
