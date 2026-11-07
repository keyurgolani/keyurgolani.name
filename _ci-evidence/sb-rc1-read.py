# Push 3's evidence only (rc1-evidence's sb jobs, ci.yml), never merged: one job's share of Spatial
# Bento's RC1 tests, read back from the run's reports, read only. It prints the summary counts
# (listed, expected, skipped, unexpected), each unexpected test's title with its records (check,
# rule, target), each root-text record's target and width, and each of its cells' #sb-menu state
# at 390x844 reduced-transparency (the cell that flickered on macOS, complete / system, is held
# against its siblings in E's CI read, across the five jobs). Exit 1 if the reports can't be read,
# the summary's tests aren't the listed count, or a test isn't Spatial Bento's: `[rc1 <id>] FAIL`.
#   python3 -I sb-rc1-read.py <id> <reports/rc1-<id>/quality> <listed>
import collections, json, os, re, sys
job, root, listed = sys.argv[1], sys.argv[2], int(sys.argv[3] or 0)
tag = f'[rc1 {job}]'
try:
    tests = json.load(open(os.path.join(root, 'summary.json'), encoding='utf-8')).get('tests', [])
except Exception as e:
    print(f'{tag} FAIL: summary.json unreadable: {e}'); sys.exit(1)
ran = [t for t in tests if t.get('cell')]
sb = [t for t in ran if (t.get('cell') or '').startswith('composition:spatial-bento ')]
counts = collections.Counter(t.get('outcome') for t in sb)
print(f"{tag} listed {listed}; in the summary {len(ran)}, SB's {len(sb)}: expected {counts['expected']}, skipped {counts['skipped']}, unexpected {counts['unexpected']}, other {len(sb) - counts['expected'] - counts['skipped'] - counts['unexpected']}")
records = []
for dp, _, fn in os.walk(os.path.join(root, 'results')):
    if 'quality-records.json' not in fn: continue
    try: records += json.load(open(os.path.join(dp, 'quality-records.json'), encoding='utf-8'))
    except Exception as e: print(f'{tag} unreadable {dp}: {e}')
for t in sb:
    if t.get('outcome') != 'unexpected': continue
    print(f"{tag} unexpected: {t.get('cell')} @{t.get('viewport')} {t.get('row')}")
    for f in t.get('failures') or []:
        print(f"{tag}   {f.get('check')} {f.get('rule')} {f.get('target')}")
roots = [r for r in records if r.get('rule') == 'root-text' and 'spatial-bento' in str(r.get('surface'))]
for r in roots:
    tup = r.get('tuple') or {}
    width = re.findall(r'(\d+)px of content in 1024px', r.get('actual') or '')
    print(f"{tag} root-text: {r.get('surface')} {r.get('route')} {tup.get('designLanguage')}/{tup.get('displayMode')} @{r.get('viewport')} {r.get('preferenceMode')} target {(r.get('element') or {}).get('selector')} width {width} | {(r.get('actual') or '')[:160]}")
print(f'{tag} root-text records: {len(roots)}')
for t in sb:
    if t.get('viewport') != '390x844' or t.get('row') != 'reduced-transparency': continue
    menu = any(f.get('target') == '#sb-menu' for f in t.get('failures') or [])
    print(f"{tag} #sb-menu at 390x844 reduced-transparency: {t.get('cell')} {t.get('outcome')}, {'red' if menu else 'not red'}")
fail = []
if len(ran) != listed: fail.append(f'the summary has {len(ran)} tests, not the {listed} listed')
if len(sb) != len(ran): fail.append(f"{len(ran) - len(sb)} test(s) aren't Spatial Bento's")
if fail: print(f"{tag} FAIL: {'; '.join(fail)}")
sys.exit(1 if fail else 0)
