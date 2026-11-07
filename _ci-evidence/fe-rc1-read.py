# Push 3's evidence only (rc1-evidence's fe jobs, ci.yml), never merged: one job's share of RC1's
# default-row tests at 1440x900, read back from the run's reports, read only. It prints the counts
# (listed, expected, skipped, unexpected), how many ran owing failed enhancement, each unexpected
# test with its records (check, rule, target), and every enhancement-gate or own-scripts runner
# record. The bars come from the run's own plan.json: its 1440x900 default tests whose cell id
# matches <cells> are exactly the listed count, and those it plans to run with the content
# conditions are exactly the tests that ran owing failed enhancement. Exit 1 if the reports can't
# be read, or a bar fails: `[rc1 <id>] FAIL`.
#   python3 -I fe-rc1-read.py <id> <reports/rc1-<id>/quality> <listed> <cells: a regex of cell ids>
import collections, json, os, re, sys
job, root, listed, cells_re = sys.argv[1], sys.argv[2], int(sys.argv[3] or 0), re.compile(sys.argv[4])
tag = f'[rc1 {job}]'
try:
    tests = json.load(open(os.path.join(root, 'summary.json'), encoding='utf-8')).get('tests', [])
    planned = json.load(open(os.path.join(root, 'plan.json'), encoding='utf-8'))['planned']
except Exception as e:
    print(f'{tag} FAIL: summary.json or plan.json unreadable: {e}'); sys.exit(1)
mine = [p for p in planned if p.get('viewport') == '1440x900' and p.get('row') == 'default' and cells_re.search(p.get('cell') or '')]
want = [p for p in mine if p.get('skip') is None and p.get('conditions')]
cells = [t for t in tests if t.get('cell')]
counts = collections.Counter(t.get('outcome') for t in cells)
owing = [t for t in cells if t.get('outcome') != 'skipped' and 'enhancement' in (t.get('checks') or [])]
print(f"{tag} listed {listed}; the plan's {len(mine)} at 1440x900 default, {len(want)} to run with the content conditions; in the summary {len(cells)}: expected {counts['expected']}, skipped {counts['skipped']}, unexpected {counts['unexpected']}, other {len(cells) - counts['expected'] - counts['skipped'] - counts['unexpected']}; ran owing failed enhancement {len(owing)}")
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
if len(mine) != listed: fail.append(f"the plan has {len(mine)} of the job's tests, not the {listed} listed")
if len(cells) != listed: fail.append(f'the summary has {len(cells)} tests, not the {listed} listed')
stray = [t for t in cells if (t.get('viewport'), t.get('row')) != ('1440x900', 'default') or not cells_re.search(t.get('cell') or '')]
if stray: fail.append(f"{len(stray)} test(s) outside the job's cells at 1440x900 default")
if len(owing) != len(want): fail.append(f'{len(owing)} tests ran owing failed enhancement, not the plan\'s {len(want)}')
print(f"{tag} owing failed enhancement: {len(owing)}, the plan's {len(want)}")
if fail: print(f"{tag} FAIL: {'; '.join(fail)}")
sys.exit(1 if fail else 0)
