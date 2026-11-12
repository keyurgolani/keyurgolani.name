# Rows 146 and 111's evidence only (hc146-evidence-e2e and hc146-evidence-cells, ci.yml), never merged: each job's
# tests read back from its report, read only. The reds are the evidence, read by the lead, never judged here; it
# fails only when the report doesn't hold exactly the job's tests once each.
#   python3 -I hc146-read.py e2e <playwright results.json> <listed count>
#   python3 -I hc146-read.py cells <reports quality dir> <listed count>
import json, os, sys

mode, path, listed = sys.argv[1], sys.argv[2], int(sys.argv[3] or 0)
tag = f'[hc146 {mode}]'
bad = []
if mode == 'e2e':
    try:
        report = json.load(open(path, encoding='utf-8'))
    except Exception as e:
        print(f'{tag} FAIL: {path} unreadable: {e}'); sys.exit(1)
    tests = []
    def walk(suite, file):
        file = suite.get('file', file)
        for spec in suite.get('specs', []):
            for test in spec.get('tests', []):
                results = test.get('results', [])
                last = results[-1] if results else {}
                err = (last.get('error') or {}).get('message', '') or ''
                loc = (last.get('error') or {}).get('location') or {}
                tests.append((file, spec.get('title', ''), test.get('status', ''), last.get('status', ''), loc.get('line'), err.splitlines()[0][:200] if err else ''))
        for child in suite.get('suites', []):
            walk(child, file)
    for suite in report.get('suites', []):
        walk(suite, suite.get('file', ''))
    by_file = {}
    for file, title, status, result, line, err in tests:
        by_file.setdefault(file, {}).setdefault(result or status, 0)
        by_file[file][result or status] += 1
    print(f'{tag} listed {listed}; the report holds {len(tests)} test(s)')
    for file, counts in sorted(by_file.items()):
        print(f'{tag} {file}: ' + ', '.join(f'{k} {v}' for k, v in sorted(counts.items())))
    for file, title, status, result, line, err in tests:
        if result not in ('passed', 'skipped'):
            print(f'{tag}   {result} {file}:{line} {title[:110]} | {err}')
    if len(tests) != listed:
        bad.append(f'the report holds {len(tests)} tests, not the {listed} listed')
elif mode == 'cells':
    HC = 'composition:horizontal-cinema complete / horizontal-cinema/platform-neutral/warm-parchment/humanist-ui/'
    WANT = [(HC + m, '390x844', row) for m in ('light', 'dark', 'high-contrast', 'system') for row in ('default', 'contrast-more', 'forced-colors')]
    FOLDS = tuple(f'#scene-{n} > details:nth-child(3) > summary:nth-child(1)' for n in (5, 6, 15))
    try:
        tests = json.load(open(os.path.join(path, 'summary.json'), encoding='utf-8'))['tests']
    except Exception as e:
        print(f'{tag} FAIL: summary.json unreadable: {e}'); sys.exit(1)
    cells = [t for t in tests if t.get('kind') == 'cell' and t.get('engine') == 'chromium']
    print(f'{tag} listed {listed}; the summary holds {len(cells)} cell test(s); the job wants {len(WANT)}')
    folds_total = 0
    for cell, viewport, row in WANT:
        found = [t for t in cells if t['cell'] == cell and t.get('viewport') == viewport and t.get('row') == row]
        if len(found) != 1:
            bad.append(f'{cell} {viewport} {row}: {len(found)} in the summary, not 1'); continue
        t = found[0]
        fails = [f for k in ('failures', 'softFailures') for f in (t.get(k) if isinstance(t.get(k), list) else [])]
        folds = [f for f in fails if f.get('check') == 'focus' and f.get('target') in FOLDS]
        folds_total += len(folds)
        other = [(f.get('check'), f.get('rule'), f.get('target')) for f in fails if f not in folds]
        print(f"{tag} {cell.split('/')[-1]:14} {row:13} {t.get('status', ''):8} fold focus {len(folds)}; other {other}")
    print(f'{tag} fold focus records: {folds_total} across {len(WANT)} cells')
    if len(cells) != listed:
        bad.append(f'the summary holds {len(cells)} cell tests, not the {listed} listed')
else:
    print(f'{tag} FAIL: unknown mode'); sys.exit(1)
for line in bad:
    print(f'{tag} FAIL: {line}')
sys.exit(1 if bad else 0)
