# Row 119's evidence only, never merged: the twelve Kinetic Cosmos cells at 1024x768 under reduced
# transparency on platform-neutral/warm-parchment/humanist-ui, read back from the job's summary.json,
# each with its status and its transparency failures, and every other failure listed. It fails only
# when the summary doesn't hold exactly those twelve cells once each: the reds themselves are the
# evidence, read by the lead, never judged here.
#   python3 -I kc-row119-read.py <reports quality dir> <listed count>
import json, os, sys
quality, listed = sys.argv[1], sys.argv[2]
P = 'composition:kinetic-cosmos '
PACK = ' kinetic-cosmos/platform-neutral/warm-parchment/humanist-ui/'
CELLS = [f'{P}{c}{PACK}{m}' for c in ('complete /', 'complete /work/project-name', 'missing-media /', 'sparse /')
         for m in ('light', 'dark', 'system')]
RECORDS = {f'{P}complete /{PACK}light', f'{P}complete /{PACK}system', f'{P}complete /work/project-name{PACK}light',
           f'{P}complete /work/project-name{PACK}system', f'{P}missing-media /{PACK}dark', f'{P}sparse /{PACK}light',
           f'{P}sparse /{PACK}system'}
tests = json.load(open(os.path.join(quality, 'summary.json')))['tests']
cells = [t for t in tests if t.get('kind') == 'cell' and t.get('viewport') == '1024x768'
         and t.get('row') == 'reduced-transparency' and t.get('engine') == 'chromium']
bad = []
print(f'[row119] listed {listed}; the summary holds {len(cells)} such cell test(s)')
for cell in CELLS:
    found = [t for t in cells if t['cell'] == cell]
    if len(found) != 1:
        bad.append(f'{cell}: {len(found)} in the summary, not 1'); continue
    t = found[0]
    rt = [(f.get('rule'), f.get('target')) for f in t.get('failures', []) if f.get('check') == 'transparency']
    other = [(f.get('check'), f.get('rule'), f.get('target')) for f in t.get('failures', []) if f.get('check') != 'transparency']
    mark = 'record' if cell in RECORDS else 'control'
    print(f"[row119] {mark:7} {cell[len(P):]:88} {t['status']:8} transparency={rt} other={other}")
extra = sorted({t['cell'] for t in cells} - set(CELLS))
if extra: bad.append(f'cells beyond the twelve: {extra}')
for line in bad: print(f'[row119] FAIL: {line}')
sys.exit(1 if bad else 0)
