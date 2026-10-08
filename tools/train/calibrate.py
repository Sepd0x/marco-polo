"""Isotonic calibration and threshold per source family (plan B6).

    python tools/train/calibrate.py --rows <rows.json> --model <model.json> --out <calibrated.json>
        [--exclude <zone> ...] [--parity <parity-seedN.json> --parity-out <model-parity.json>]

Rows come from calibrate.ts: raw score of every detection on the calibration
zones and whether the benchmark counted it as a hit. Each family gets a
monotone map from raw score to probability; its threshold is the calibrated
value with the best F1 there (ties: the higher one). `default` pools all rows.

--exclude leaves zones out of the fit: report.ts calibrates each DEV zone
without it, so the DEV numbers it reports are out of fold. --parity writes
the reference scores the TypeScript test compares the shipped model with.
"""
import argparse
import hashlib
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
    return iso, cal, float(best[1]), float(best[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rows', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--exclude', action='append', default=[])
    ap.add_argument('--parity')
    ap.add_argument('--parity-out')
    a = ap.parse_args()
    data = json.load(open(a.rows, encoding='utf-8'))
    model = json.load(open(a.model, encoding='utf-8'))
    if model['calibration']:
        raise SystemExit('give the uncalibrated model')
    rows = [r for r in data['rows'] if r['zone'] not in a.exclude]
    zones = [z for z in data['zones'] if z not in a.exclude]
    labels = {}
    for z in zones:
        fam = data['familyByZone'][z]
        labels[fam] = labels.get(fam, 0) + data['labelsByZone'][z]
    fams = sorted({r['family'] for r in rows})
    report, isos = {}, {}
    for fam in fams + ['default']:
        sel = [r for r in rows if fam == 'default' or r['family'] == fam]
        s = np.array([r['score'] for r in sel], dtype=np.float64)
        y = np.array([r['y'] for r in sel], dtype=np.float64)
        n = sum(labels.values()) if fam == 'default' else labels[fam]
        if len(set(y.tolist())) < 2:
            continue
        iso, cal, thr, f1 = fit(s, y, n)
        isos[fam] = iso
        model['calibration'][fam] = cal
        model['thresholds'][fam] = round(thr, 6)
        report[fam] = {'detections': len(sel), 'hits': int(y.sum()), 'labels': n, 'threshold': round(thr, 4), 'f1AtThreshold': round(f1, 4)}
        print(fam, report[fam])
    model['meta']['calibration'] = {'zones': zones, 'excluded': a.exclude, 'byFamily': report}
    text = json.dumps(model, separators=(',', ':'))
    with open(a.out, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    if a.parity:
        ref = json.load(open(a.parity, encoding='utf-8'))
        blend = np.array(ref['blend'], dtype=np.float64)
        ref['calibrated'] = {fam: iso.predict(blend).tolist() for fam, iso in isos.items()}
        ref['modelSha256'] = hashlib.sha256(text.encode('utf-8')).hexdigest()
        with open(a.parity_out, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(ref, fh, separators=(',', ':'))


if __name__ == '__main__':
    main()
