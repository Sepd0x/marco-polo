"""Isotonic calibration and threshold per source family (plan B6).

    python tools/train/calibrate.py --rows <rows.json> --model <model.json> --out <calibrated.json>
        [--exclude <zone> ...] [--parity <parity-seedN.json> --parity-out <model-parity.json>]

Rows come from calibrate.ts: raw score of every detection on the calibration
zones and whether the benchmark counted it as a hit. Each family gets a
monotone map from raw score to probability. Its threshold follows plan B6:
the value with the best F1 out of fold over the family's zones (each zone
scored by a map fitted on the others; ties: the higher one). A family with a
single calibration zone has no out-of-fold estimate and gets no map of its
own: it reads `default`, which pools all zones, with a threshold chosen out
of fold the same way.

No Esri row is accepted: Esri's terms forbid using its data to train
systems. Esri reads the pooled map, and its threshold is fixed to the pooled
threshold, written as its own entry so the product and the docs name it.

--exclude leaves zones out of the fit: report.ts calibrates each DEV zone
without it, so the DEV numbers it reports are out of fold. --parity writes
the reference scores the TypeScript test compares the shipped model with.
"""
import argparse
import hashlib
import json

import numpy as np
from sklearn.isotonic import IsotonicRegression


NO_TRAINING_FAMILIES = ['esri']


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


def best_threshold(p, ys, n_labels):
    """Calibrated value with the best F1 (ties: the higher one)."""
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
    return float(best[1]), float(best[0])


def oof_threshold(rows, zones, labels_by_zone):
    """Threshold from out-of-fold probabilities over `zones`, or None with fewer than two zones."""
    if len(zones) < 2:
        return None
    ps, ys = [], []
    for z in zones:
        train = [r for r in rows if r['zone'] != z]
        test = [r for r in rows if r['zone'] == z]
        yt = np.array([r['y'] for r in train], dtype=np.float64)
        if not test:
            continue
        if len(set(yt.tolist())) < 2:
            return None
        iso = IsotonicRegression(y_min=0.0, y_max=1.0, increasing=True, out_of_bounds='clip').fit(
            np.array([r['score'] for r in train], dtype=np.float64), yt)
        ps.append(iso.predict(np.array([r['score'] for r in test], dtype=np.float64)))
        ys.append(np.array([r['y'] for r in test], dtype=np.float64))
    n = sum(labels_by_zone[z] for z in zones)
    return best_threshold(np.concatenate(ps), np.concatenate(ys), n)


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
    if any(r['family'] in NO_TRAINING_FAMILIES for r in data['rows']):
        raise SystemExit(f'rows from {NO_TRAINING_FAMILIES} imagery: its terms forbid using it to calibrate')
    rows = [r for r in data['rows'] if r['zone'] not in a.exclude]
    zones = [z for z in data['zones'] if z not in a.exclude]
    labels = {}
    for z in zones:
        fam = data['familyByZone'][z]
        labels[fam] = labels.get(fam, 0) + data['labelsByZone'][z]
    fams = sorted({r['family'] for r in rows})
    labels_by_zone = {z: data['labelsByZone'][z] for z in zones}
    zones_of = {fam: [z for z in zones if data['familyByZone'][z] == fam] for fam in fams}
    zones_of['default'] = list(zones)
    report, isos = {}, {}
    for fam in ['default'] + fams:
        sel = [r for r in rows if fam == 'default' or r['family'] == fam]
        s = np.array([r['score'] for r in sel], dtype=np.float64)
        y = np.array([r['y'] for r in sel], dtype=np.float64)
        n = sum(labels.values()) if fam == 'default' else labels[fam]
        if len(set(y.tolist())) < 2:
            continue
        iso, cal, thr_in, f1_in = fit(s, y, n)
        own = oof_threshold(sel, zones_of[fam], labels_by_zone)
        if fam != 'default' and own is None:
            # One zone of its own: the family reads the pooled map and threshold (model.ts falls back to default).
            report[fam] = {'detections': len(sel), 'hits': int(y.sum()), 'labels': n, 'uses': 'default (one calibration zone, no out-of-fold estimate)', 'inSampleThreshold': round(thr_in, 4), 'inSampleF1': round(f1_in, 4)}
            print(fam, report[fam])
            continue
        if own is not None:
            thr, how = own[0], f'out of fold over its {len(zones_of[fam])} zones'
        else:
            thr, how = thr_in, 'in sample (too few zones for out of fold)'
        isos[fam] = iso
        model['calibration'][fam] = cal
        model['thresholds'][fam] = round(thr, 6)
        report[fam] = {'detections': len(sel), 'hits': int(y.sum()), 'labels': n, 'threshold': round(thr, 4), 'thresholdFrom': how, 'inSampleThreshold': round(thr_in, 4), 'inSampleF1': round(f1_in, 4)}
        print(fam, report[fam])
    for fam in NO_TRAINING_FAMILIES:
        model['thresholds'][fam] = model['thresholds']['default']
        report[fam] = {'uses': 'default map; threshold fixed to the pooled threshold, never fitted on its imagery (terms of use)'}
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
