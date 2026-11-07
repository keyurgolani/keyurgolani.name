# Push 3 r5's evidence only (fe-rc1-evidence, ci.yml), never merged: RC1's default-row tests on one
# side (base or head), read back from the run's reports, read only. It prints the counts (listed,
# expected, skipped, unexpected), how many ran owing failed enhancement, each unexpected test with
# its records (check, rule, target), and every enhancement-gate or own-scripts runner record. Exit
# 1 if the reports can't be read, the summary's tests aren't the listed count, or the tests that
# ran owing failed enhancement aren't exactly <owing> (333 in RC1's plan): `[fe-rc1 <side>] FAIL`.
#   python3 -I fe-rc1-read.py <side> <reports/fe-rc1-<side>/quality> <listed> <owing>
import collections, json, os, sys
side, root, listed, want = sys.argv[1], sys.argv[2], int(sys.argv[3] or 0), int(sys.argv[4])
tag = f'[fe-rc1 {side}]'
try:
    tests = json.load(open(os.path.join(root, 'summary.json'), encoding='utf-8')).get('tests', [])
except Exception as e:
    print(f'{tag} summary.json unreadable: {e}'); sys.exit(1)
cells = [t for t in tests if t.get('cell')]
counts = collections.Counter(t.get('outcome') for t in cells)
owing = [t for t in cells if t.get('outcome') != 'skipped' and 'enhancement' in (t.get('checks') or [])]
print(f"{tag} listed {listed}; in the summary {len(cells)}: expected {counts['expected']}, skipped {counts['skipped']}, unexpected {counts['unexpected']}, other {len(cells) - counts['expected'] - counts['skipped'] - counts['unexpected']}; ran owing failed enhancement {len(owing)}")
for t in cells:
    if t.get('outcome') != 'unexpected': continue
    print(f"{tag} unexpected: {t.get('cell')} @{t.get('viewport')} {t.get('row')}")
    for f in t.get('failures') or []:
        print(f"{tag}   {f.get('check')} {f.get('rule')} {f.get('target')}")
n = 0
for dp, _, fn in os.walk(os.path.join(root, 'results')):
    if 'quality-records.json' not in fn: continue
    try: records = json.load(open(os.path.join(dp, 'quality-records.json'), encoding='utf-8'))
    except Exception as e: print(f'{tag} unreadable {dp}: {e}'); continue
    for r in records:
        if r.get('check') == 'enhancement' or (r.get('check') == 'runner' and r.get('rule') == 'own-scripts'):
            n += 1
            tup = r.get('tuple') or {}
            print(f"{tag} record: {r.get('surface')} {r.get('route')} {tup.get('designLanguage')}/{tup.get('displayMode')} @{r.get('viewport')} | {r.get('check')} {r.get('rule')} | {(r.get('element') or {}).get('selector')} | {(r.get('expected') or '')[:80]} | {(r.get('actual') or '')[:160]}")
print(f'{tag} enhancement and own-scripts records: {n}')
fail = []
if len(cells) != listed: fail.append(f'the summary has {len(cells)} tests, not the {listed} listed')
if len(owing) != want: fail.append(f'{len(owing)} tests ran owing failed enhancement, not {want}')
print(f'{tag} owing failed enhancement: {len(owing)}, want exactly {want}')
if fail: print(f"{tag} FAIL: {'; '.join(fail)}")
sys.exit(1 if fail else 0)
