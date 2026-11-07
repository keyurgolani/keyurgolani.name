"""Batch K's cell reader (evidence only, not for merge): names each of the 16 cells' status and keys.

  python3 -I -B ci/evidence/batch-k/k-read.py <reports dir>

The dir is the cells run's CI_REPORTS_DIR: its summary.json and the quality-records.json files
beside it, searched under it. The cells are Kinetic Cosmos's on warm-parchment/humanist-ui/system at
1440x900: the 12 packs' print cells and #197's 4 reduced-transparency cells.
- print (row 94's bar): each cell is present once, finished (passed or failed, with checks), passed,
  with no record; #197's key there (axe color-contrast on "Hero tagline") is named GONE or STILL RED.
- reduced-transparency (row 91's, expected red at the head): status and keys shown as data, with
  #197's keys there named STILL RED or GONE; never a failure.
- A cell outside the 16 in the run, or one of the 16 absent or there twice, misses.
Fails closed: a cell whose records don't parse to its summary's `records` count exits 2.
Exits 0 when every bar holds, 1 when one misses, 2 when the reports can't be read.
"""
import collections, json, os, sys

PACKS = ('carbon-inspired fluent-2-inspired glassmorphism international-grid material-3-inspired minimal-flat '
         'neobrutalist paper-tactile platform-neutral primer-inspired soft-organic spectrum-2-inspired').split()
# #197's CI-red keys (its quality-pr logs): the print cells' one, and the reduced-transparency cells'
# opaque targets.
PRINT_197 = ('color-contrast', 'Hero tagline')
RT_197 = {
    'fluent-2-inspired': ('#kc--index', '#services--offer-0-0'),
    'platform-neutral': ('#services--offer-0-0',),
    'soft-organic': ('#kc--index', '#services--offer-0-0'),
    'spectrum-2-inspired': ('#kc--index',),
}
TAIL = '/warm-parchment/humanist-ui/system'
VIEWPORT = '1440x900'


def cell_id(lang):
    return f'composition:kinetic-cosmos complete / kinetic-cosmos/{lang}{TAIL}'


def refuse(msg):
    print(f'k-read: REFUSED: {msg}')
    sys.exit(2)


def main():
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        refuse('usage: k-read.py <reports dir>')
    root = sys.argv[1]
    tests, recs, nsum = [], [], 0
    for d, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f)
            if f == 'summary.json':
                data = json.load(open(p, encoding='utf-8'))
                if not isinstance(data, dict) or not isinstance(data.get('tests'), list):
                    refuse(f'{p}: no tests list (unknown format)')
                nsum += 1
                tests += [t for t in data['tests'] if isinstance(t, dict) and t.get('kind') == 'cell']
            elif f == 'quality-records.json':
                data = json.load(open(p, encoding='utf-8'))
                if isinstance(data, dict):
                    data = data.get('records')
                if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
                    refuse(f'{p}: records unread (unknown format)')
                recs += data
    if nsum != 1:
        refuse(f'{nsum} summary.json files under {root}, want 1')
    want = collections.OrderedDict()
    for lang in PACKS:
        want[(cell_id(lang), VIEWPORT, 'print')] = ('print', lang)
    for lang in RT_197:
        want[(cell_id(lang), VIEWPORT, 'reduced-transparency')] = ('reduced-transparency', lang)
    by_key = collections.defaultdict(list)
    for t in tests:
        by_key[(t.get('cell'), t.get('viewport'), t.get('row'))].append(t)
    keys_of = collections.defaultdict(list)
    for r in recs:
        tup = r.get('tuple') or {}
        el = r.get('element') or {}
        keys_of[(tup.get('designLanguage'), r.get('viewport'), r.get('preferenceMode'))].append(
            (r.get('check'), r.get('rule'), el.get('accessibleName'), el.get('selector') or r.get('target')))
    rc = 0
    print(f'k-read: {len(tests)} cell tests in the summary, {len(recs)} records; want {len(want)} cells '
          f'({len(PACKS)} print, {len(RT_197)} reduced-transparency)')
    extra = [k for k in by_key if k not in want]
    for k in extra:
        print(f'MISSED: a cell outside the 16 ran: {k[0]} {k[1]} {k[2]}')
        rc = 1
    held = collections.Counter()
    for k, (kind, lang) in want.items():
        name = f'kinetic-cosmos/{lang}{TAIL} {VIEWPORT} {kind}'
        found = by_key.get(k, [])
        if len(found) != 1:
            print(f'MISSED: {name}: in the run {len(found)} times, want 1')
            rc = 1
            continue
        t = found[0]
        status, checks = t.get('status'), t.get('checks') or []
        keys = keys_of.get((lang, VIEWPORT, kind), [])
        if t.get('records') is None or len(keys) != t['records']:
            refuse(f'{name}: summary counts {t.get("records")} record(s), parsed {len(keys)}')
        done = status in ('passed', 'failed') and bool(checks)
        if kind == 'print':
            had = any(c[1] == PRINT_197[0] and c[2] == PRINT_197[1] for c in keys)
            ok = done and status == 'passed' and not keys
            held[kind] += ok
            print(f'{"ok" if ok else "MISSED"}: {name}: {status}, checks {len(checks)}, keys {len(keys)}; '
                  f'#197\'s {PRINT_197[0]} on "{PRINT_197[1]}" {"STILL RED" if had else "GONE"}')
            rc = rc if ok else 1
        else:
            red = [s for s in RT_197[lang] if any(c[1] == 'opaque' and c[3] == s for c in keys)]
            gone = [s for s in RT_197[lang] if s not in red]
            print(f'data (row 91\'s, expected red): {name}: {status}{"" if done else " (not finished)"}, '
                  f'checks {len(checks)}, keys {len(keys)}; #197\'s opaque keys STILL RED {len(red)} of '
                  f'{len(RT_197[lang])} {list(red)}, GONE {list(gone)}')
        for c in keys:
            print(f'    key | {c[0]} | {c[1]} | {c[2]} | {c[3]}')
    print(f'k-read: print cells green with no key {held["print"]} of {len(PACKS)} (row 94\'s bar); '
          f'reduced-transparency cells shown as data {len(RT_197)}; exit {rc}')
    sys.exit(rc)


main()
