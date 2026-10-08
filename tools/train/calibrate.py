"""Isotonic calibration and threshold per source family (plan B6).

    python tools/train/calibrate.py --rows <rows.json> --model <model.json> --out <calibrated.json>

Rows come from calibrate.ts: raw score of every detection on the calibration
zones and whether the benchmark counted it as a hit. Each family gets a
monotone map from raw score to probability; its threshold is the calibrated
value with the best F1 there (ties: the higher one). `default` pools all rows.
"""
import argparse
import json

import numpy as np
from sklearn.isotonic import IsotonicRegression


def fit(scores, ys, n_labels):
    iso = IsotonicRegression(y_min=0.0, y_max=1.0, increasing=True, out_of_bounds='clip').fit(scores, ys)
    p = iso.predict(scores)
    best = (-1.0, 0.5)
    for t in sorted(set(np.round(p, 6).tolist())):
        if t <= 0:
            continue
        sel = p >= t - 1e-12
        tp = float(ys[sel].sum())
        fp = float(sel.sum() - tp)
        fn = max(0.0, n_labels - tp)
        f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
        if f1 > best[0] + 1e-12 or (abs(f1 - best[0]) <= 1e-12 and t > best[1]):
            best = (f1, t)
    cal = {'x': [float(v) for v in iso.X_thresholds_], 'y': [float(v) for v in iso.y_thresholds_]}
    return cal, float(best[1]), float(best[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rows', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    data = json.load(open(a.rows, encoding='utf-8'))
    model = json.load(open(a.model, encoding='utf-8'))
    rows = data['rows']
    fams = sorted({r['family'] for r in rows})
    report = {}
    for fam in fams + ['default']:
        sel = [r for r in rows if fam == 'default' or r['family'] == fam]
        s = np.array([r['score'] for r in sel], dtype=np.float64)
        y = np.array([r['y'] for r in sel], dtype=np.float64)
        n = sum(data['labels'].values()) if fam == 'default' else data['labels'][fam]
        cal, thr, f1 = fit(s, y, n)
        model['calibration'][fam] = cal
        model['thresholds'][fam] = round(thr, 6)
        report[fam] = {'detections': len(sel), 'hits': int(y.sum()), 'labels': n, 'threshold': round(thr, 4), 'f1AtThreshold': round(f1, 4)}
        print(fam, report[fam])
    model['meta']['calibration'] = {'zones': data['zones'], 'byFamily': report}
    with open(a.out, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(model, fh, separators=(',', ':'))


if __name__ == '__main__':
    main()
