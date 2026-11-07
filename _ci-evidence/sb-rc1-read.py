# Push 3 r4's evidence only (sb-rc1-evidence, ci.yml), never merged: Spatial Bento's RC1 cells, read
# back from the run's reports, read only. It prints the summary counts (listed, expected, skipped,
# unexpected), each unexpected test's title with its records (check, rule, target, and the record's
# own words), and each root-text record's target and width. Exit 1 only if the reports can't be read,
# or the summary's SB tests aren't the listed count.
#   python3 -I sb-rc1-read.py <reports/sb-rc1/quality> <listed>
import collections, json, os, re, sys
root, listed = sys.argv[1], int(sys.argv[2] or 0)
try:
    tests = json.load(open(os.path.join(root, 'summary.json'), encoding='utf-8')).get('tests', [])
except Exception as e:
    print(f'[sb-rc1] summary.json unreadable: {e}'); sys.exit(1)
sb = [t for t in tests if 'spatial-bento' in (t.get('cell') or '')]
counts = collections.Counter(t.get('outcome') for t in sb)
print(f"[sb-rc1] listed {listed}; in the summary {len(sb)}: expected {counts['expected']}, skipped {counts['skipped']}, unexpected {counts['unexpected']}, other {len(sb) - counts['expected'] - counts['skipped'] - counts['unexpected']}")
records = []
for dp, _, fn in os.walk(os.path.join(root, 'results')):
    if 'quality-records.json' not in fn: continue
    try: records += json.load(open(os.path.join(dp, 'quality-records.json'), encoding='utf-8'))
    except Exception as e: print(f'[sb-rc1] unreadable {dp}: {e}')
for t in sb:
    if t.get('outcome') != 'unexpected': continue
    print(f"[sb-rc1] unexpected: {t.get('cell')} @{t.get('viewport')} {t.get('row')}")
    for f in t.get('failures') or []:
        print(f"[sb-rc1]   {f.get('check')} {f.get('rule')} {f.get('target')}")
for r in records:
    if r.get('rule') != 'root-text' or 'spatial-bento' not in str(r.get('surface')): continue
    tup = r.get('tuple') or {}
    width = re.findall(r'(\d+)px of content in 1024px', r.get('actual') or '')
    print(f"[sb-rc1] root-text: {r.get('surface')} {r.get('route')} {tup.get('designLanguage')}/{tup.get('displayMode')} @{r.get('viewport')} {r.get('preferenceMode')} target {(r.get('element') or {}).get('selector')} width {width} | {(r.get('actual') or '')[:160]}")
print(f"[sb-rc1] root-text records: {sum(1 for r in records if r.get('rule') == 'root-text' and 'spatial-bento' in str(r.get('surface')))}")
# The cell that flickered on macOS (complete / system, #sb-menu under reduced transparency at 390x844:
# red in one run, green in the next), named against its eleven siblings.
WATCHED = ('composition:spatial-bento complete / spatial-bento/platform-neutral/warm-parchment/humanist-ui/system', '390x844', 'reduced-transparency')
sibs = [t for t in sb if t.get('viewport') == '390x844' and t.get('row') == 'reduced-transparency'
        and (t.get('cell') or '').split(' / ')[0] in ('composition:spatial-bento complete', 'composition:spatial-bento sparse', 'composition:spatial-bento missing-media')
        and (t.get('cell') or '').split(' ', 2)[2].startswith('/ ')]
watched = next((t for t in sibs if (t.get('cell'), t.get('viewport'), t.get('row')) == WATCHED), None)
red = [t for t in sibs if t is not watched and any(f.get('target') == '#sb-menu' for f in t.get('failures') or [])]
if watched is None:
    print('[sb-rc1] watched cell (flickered on macOS): complete / system @390x844 reduced-transparency not in the run')
else:
    mine = any(f.get('target') == '#sb-menu' for f in watched.get('failures') or [])
    print(f"[sb-rc1] watched cell (flickered on macOS): complete / system @390x844 reduced-transparency {watched.get('outcome')}, #sb-menu {'red' if mine else 'not red'}; its {len(sibs) - 1} siblings: {len(red)} red on #sb-menu"
          + (' (it differs from most of its siblings: it may flicker on Linux too)' if mine != (len(red) * 2 > len(sibs) - 1) else ''))
sys.exit(0 if len(sb) == listed else 1)
