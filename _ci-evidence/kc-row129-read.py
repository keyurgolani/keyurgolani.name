# Row 129's evidence only, never merged: Kinetic Cosmos's four missing-media cells at 390x844 in the
# default row on platform-neutral/warm-parchment/humanist-ui, read back from the job's summary.json,
# each with its status, its occlusion failures on the wordmark link, and every other failure listed.
# It fails only when the summary doesn't hold exactly those four cells once each: the reds themselves
# are the evidence, read by the lead, never judged here.
#   python3 -I kc-row129-read.py <reports quality dir> <listed count>
import json, os, sys
quality, listed = sys.argv[1], sys.argv[2]
P = 'composition:kinetic-cosmos missing-media / kinetic-cosmos/platform-neutral/warm-parchment/humanist-ui/'
CELLS = [P + m for m in ('light', 'dark', 'high-contrast', 'system')]
LINK = '#kc--top > p:nth-child(1) > a:nth-child(1)'
tests = json.load(open(os.path.join(quality, 'summary.json')))['tests']
cells = [t for t in tests if t.get('kind') == 'cell' and t.get('viewport') == '390x844'
         and t.get('row') == 'default' and t.get('engine') == 'chromium']
bad = []
print(f'[row129] listed {listed}; the summary holds {len(cells)} such cell test(s)')
for cell in CELLS:
    found = [t for t in cells if t['cell'] == cell]
    if len(found) != 1:
        bad.append(f'{cell}: {len(found)} in the summary, not 1'); continue
    t = found[0]
    fails = t.get('failures', [])
    link = [(f.get('check'), f.get('rule')) for f in fails if f.get('target') == LINK]
    other = [(f.get('check'), f.get('rule'), f.get('target')) for f in fails if f.get('target') != LINK]
    print(f"[row129] {cell[len(P):]:14} {t['status']:8} records={t.get('records')} wordmark-link={link} other={other}")
extra = sorted({t['cell'] for t in cells if t['cell'].startswith('composition:kinetic-cosmos missing-media')} - set(CELLS))
if extra: bad.append(f'missing-media cells beyond the four: {extra}')
for line in bad: print(f'[row129] FAIL: {line}')
sys.exit(1 if bad else 0)
