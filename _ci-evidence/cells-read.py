# Evidence only, never merged: the three cells read back from the job's summary.json. Obsidian
# Atelier's missing-media / in dark and high contrast at 390x844 under more contrast, and its
# complete / in Glassmorphism, Lavender Dusk and Accessible Reading, dark, at 1024x768 in the
# default row: each with its status, its focus perimeter failure on the chrome's name if any, and
# every other failure, target by target. It fails only when the summary doesn't hold exactly those
# three cells once each: the reds themselves are the evidence, never judged here.
#   python3 -I cells-read.py <reports quality dir> <listed count>
import json, os, sys
quality, listed = sys.argv[1], sys.argv[2]
OA = 'composition:obsidian-atelier '
CELLS = [
    (f'{OA}missing-media / obsidian-atelier/platform-neutral/warm-parchment/humanist-ui/dark', '390x844', 'contrast-more'),
    (f'{OA}missing-media / obsidian-atelier/platform-neutral/warm-parchment/humanist-ui/high-contrast', '390x844', 'contrast-more'),
    (f'{OA}complete / obsidian-atelier/glassmorphism/lavender-dusk/accessible-reading/dark', '1024x768', 'default'),
]
NAME = 'header:nth-child(2) > a:nth-child(2)'
tests = json.load(open(os.path.join(quality, 'summary.json')))['tests']
cells = [t for t in tests if t.get('kind') == 'cell' and t.get('engine') == 'chromium']
bad = []
print(f'[cells] listed {listed}; the summary holds {len(cells)} cell test(s)')
for cell, viewport, row in CELLS:
    found = [t for t in cells if t['cell'] == cell and t.get('viewport') == viewport and t.get('row') == row]
    label = f"{cell[len(OA):]} {viewport} {row}"
    if len(found) != 1:
        bad.append(f'{label}: {len(found)} in the summary, not 1')
        continue
    t = found[0]
    fails = t.get('failures', []) + t.get('softFailures', [])
    record = [f for f in fails if f.get('check') == 'focus' and f.get('rule') == 'perimeter'
              and (f.get('target') or '').endswith(NAME)]
    other = [(f.get('check'), f.get('rule'), f.get('target')) for f in fails if f not in record]
    print(f"[cells] {label:120} {t['status']:8} name-perimeter={'yes' if record else 'no'} other={len(other)} checks={len(t.get('checks', []))}/{len(t.get('owed', []))}")
    for check, rule, target in other:
        print(f'[cells]     other: {check} {rule} {target}')
extra = sorted({t['cell'] for t in cells} - {c for c, _, _ in CELLS})
if extra: print(f'[cells] (other cells in the summary, not judged: {len(extra)})')
for line in bad: print(f'[cells] FAIL: {line}')
sys.exit(1 if bad else 0)
