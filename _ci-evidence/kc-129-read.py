# Row 129's evidence only (r129-evidence, ci.yml), never merged: Kinetic Cosmos's four missing-media
# cells at 390x844, default row, read back from the run's reports, read only. It prints the summary's
# counts (listed, expected, skipped, unexpected), then each cell's mode, outcome, how many records it
# has, and how many of them are occlusion on the wordmark link (#kc--top > p:nth-child(1) >
# a:nth-child(1)), with every other record's check, rule and target. Its last line:
# `[r129 <id>] wordmark occlusion: N of 4 cells`. The base twin (14c88446e) should show 4, the fix
# (9d1b36c3b) 0: the CI read judges that. Exit 1 only if the reports can't be read, the summary's
# tests aren't the listed count, or a test isn't one of the four: `[r129 <id>] FAIL`.
#   python3 -I kc-129-read.py <id> <reports/r129-<id>/quality> <listed>
import collections, json, os, sys
job, root, listed = sys.argv[1], sys.argv[2], int(sys.argv[3] or 0)
tag = f'[r129 {job}]'
LINK = '#kc--top > p:nth-child(1) > a:nth-child(1)'
KC = 'composition:kinetic-cosmos missing-media / kinetic-cosmos/platform-neutral/warm-parchment/humanist-ui/'
WANT = {KC + m for m in ('light', 'dark', 'high-contrast', 'system')}
try:
    tests = json.load(open(os.path.join(root, 'summary.json'), encoding='utf-8')).get('tests', [])
except Exception as e:
    print(f'{tag} FAIL: summary.json unreadable: {e}'); sys.exit(1)
ran = [t for t in tests if t.get('cell')]
cells = [t for t in ran if t.get('cell') in WANT and t.get('viewport') == '390x844' and t.get('row') == 'default']
counts = collections.Counter(t.get('outcome') for t in cells)
print(f"{tag} listed {listed}; in the summary {len(ran)}, the four's {len(cells)}: expected {counts['expected']}, skipped {counts['skipped']}, unexpected {counts['unexpected']}, other {len(cells) - counts['expected'] - counts['skipped'] - counts['unexpected']}")
occluded = 0
for t in sorted(cells, key=lambda t: t['cell']):
    recs = [x for k in ('failures', 'softFailures') for x in (t.get(k) if isinstance(t.get(k), list) else [])]
    hit = [x for x in recs if x.get('check') == 'occlusion' and (x.get('target') or '') == LINK]
    occluded += 1 if hit else 0
    print(f"{tag} {t['cell'].split('/')[-1]}: {t.get('outcome')}, {len(recs)} records, {len(hit)} occlusion on the wordmark link")
    for x in recs:
        if x not in hit:
            print(f"{tag}   other: {x.get('check')} {x.get('rule')} {x.get('target')}")
print(f'{tag} wordmark occlusion: {occluded} of {len(cells)} cells')
fail = []
if len(ran) != listed: fail.append(f'the summary has {len(ran)} tests, not the {listed} listed')
if len(cells) != len(ran): fail.append(f"{len(ran) - len(cells)} test(s) aren't the four cells")
if fail: print(f"{tag} FAIL: {'; '.join(fail)}")
sys.exit(1 if fail else 0)
