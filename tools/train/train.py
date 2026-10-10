"""Train the v2 pool scorer from the prepared candidates (tools/train/prepare.ts).

    python tools/train/train.py --work <dir> [--seed N] [--out model.json]

Reads the recipe, every training window and copy, keeps candidates whose
centroid lies in their window, drops out-of-fold confident negatives (plan B5),
trains the gradient-boosted trees and the MLP with one seed and writes the
model JSON the TypeScript scorer reads, uncalibrated. Python 3.14, CPU,
versions in requirements.txt. Features are never computed here.
"""
import argparse
import hashlib
import json
import os
import sys

import lightgbm as lgb
import numpy as np
from sklearn.metrics import roc_auc_score
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def family(source):
    return 'dgt' if source.startswith('dgt') else source


def load(work, recipe, names):
    nf = len(names)
    rows, feats = [], []
    seen = set()
    court_only = recipe['courts'].get('zones', []) if recipe.get('courts') else []
    for z in recipe['zones'] + court_only:
        zdir = os.path.join(work, z['id'])
        wins = [] if z in court_only else json.load(open(os.path.join(zdir, 'windows.json'), encoding='utf-8'))['windows']
        if recipe.get('courts'):
            # Windows around sports pitches: only the candidates on a pitch carry a target (0).
            wins = wins + json.load(open(os.path.join(zdir, 'courts.json'), encoding='utf-8'))['windows']
        for w in wins:
            b = w['bbox']
            for copy in range(recipe['copies']):
                base = os.path.join(zdir, f"{w['id']}-c{copy}")
                with open(base + '.jsonl', encoding='utf-8') as fh:
                    rs = [json.loads(line) for line in fh if line.strip()]
                if not rs:
                    continue
                f = np.fromfile(base + '.f64', dtype='<f8').reshape(len(rs), nf)
                for r, x in zip(rs, f):
                    if not (b['west'] <= r['lon'] < b['east'] and b['south'] < r['lat'] <= b['north']):
                        continue
                    # Windows overlap by 64 px: a candidate there comes twice.
                    key = (z['id'], copy, r['level'], r['px'], round(r['lon'], 7), round(r['lat'], 7))
                    if key in seen:
                        continue
                    seen.add(key)
                    r['zone'], r['copy'], r['family'], r['window'] = z['id'], copy, family(z['source']), w['id']
                    rows.append(r)
                    feats.append(x)
    return rows, np.array(feats, dtype=np.float64)


def gbdt(recipe, seed):
    p = dict(recipe['gbdt'])
    return lgb.LGBMClassifier(**p, verbose=-1, random_state=seed, deterministic=True, force_row_wise=True, num_threads=1)


def mlp(recipe, seed):
    p = dict(recipe['mlp'])
    p['hidden_layer_sizes'] = tuple(p['hidden_layer_sizes'])
    return MLPClassifier(**p, random_state=seed)


def fit_mlp(recipe, seed, X, y):
    scaler = StandardScaler().fit(X)
    net = mlp(recipe, seed).fit(scaler.transform(X), y)
    return scaler, net


# Digits kept in the exported model. Rounding keeps it under 100 KB gzip; the
# TypeScript scores stay within 1e-7 of LightGBM and scikit-learn (parity test).
SPLIT_DIGITS = 12
VALUE_DIGITS = 9


def rnd(x, digits):
    return float(f'{x:.{digits}g}')


def export_gbdt(model):
    dump = model.booster_.dump_model()
    out = {'f': [], 't': [], 'l': [], 'r': [], 'v': [], 'bias': 0.0}
    for tree in dump['tree_info']:
        F, T, L, R, V = [], [], [], [], []

        def walk(n):
            i = len(F)
            F.append(-1)
            T.append(0.0)
            L.append(-1)
            R.append(-1)
            V.append(0.0)
            if 'leaf_value' in n:
                V[i] = rnd(n['leaf_value'], VALUE_DIGITS)
                return i
            if n['decision_type'] != '<=':
                raise ValueError(n['decision_type'])
            F[i] = int(n['split_feature'])
            T[i] = rnd(n['threshold'], SPLIT_DIGITS)
            L[i] = walk(n['left_child'])
            R[i] = walk(n['right_child'])
            return i

        walk(tree['tree_structure'])
        for k, a in zip('ftlrv', (F, T, L, R, V)):
            out[k].append(a)
    return out


def export_mlp(scaler, net):
    return {
        'mean': [rnd(v, SPLIT_DIGITS) for v in scaler.mean_],
        'scale': [rnd(v, SPLIT_DIGITS) for v in scaler.scale_],
        'weights': [[[rnd(v, VALUE_DIGITS) for v in row] for row in w] for w in net.coefs_],
        'biases': [[rnd(v, VALUE_DIGITS) for v in b] for b in net.intercepts_],
    }


def blend(recipe, g, n):
    w = recipe['gbdtWeight']
    return w * g + (1 - w) * n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='C:/dev/mp-research/detect-v2/train-work')
    ap.add_argument('--recipe', default=os.path.join(HERE, 'recipe.json'))
    ap.add_argument('--seed', type=int, default=None)
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    recipe_bytes = open(a.recipe, 'rb').read()
    recipe = json.loads(recipe_bytes)
    seed = recipe['shipSeed'] if a.seed is None else a.seed
    names = json.load(open(os.path.join(a.work, 'prepared.json'), encoding='utf-8'))['features']
    if names != FEATURE_NAMES:
        raise SystemExit('feature names of the prepared candidates differ from this trainer')
    rows, X = load(a.work, recipe, names)
    y = np.array([r['y'] for r in rows])
    zones = np.array([r['zone'] for r in rows])
    keep = y >= 0
    print(f'{len(rows)} candidates, {int((y == 1).sum())} pool, {int((y == 0).sum())} not, {int((y == -1).sum())} left out (ambiguous or off-pitch)')

    # Plan B5: out-of-fold scores, leave one zone out; confident "not a pool" rows become ignore.
    oof = np.full(len(rows), np.nan)
    for z in recipe['zones']:
        test = (zones == z['id']) & keep
        train = (zones != z['id']) & keep
        if test.sum() == 0 or len(set(y[train])) < 2:
            continue
        m = gbdt(recipe, 0).fit(X[train], y[train])
        oof[test] = m.predict_proba(X[test])[:, 1]
    # Pitch candidates are negatives because OSM maps a pitch there, not because nobody boxed them: never flagged.
    court = np.array([r.get('court', 0) == 1 for r in rows])
    flagged = keep & (y == 0) & ~court & (oof > recipe['negatives']['ignoreAbove'])
    review = [
        {'zone': r['zone'], 'window': r['window'], 'copy': r['copy'], 'lon': round(r['lon'], 7), 'lat': round(r['lat'], 7), 'areaM2': r['areaM2'], 'oof': round(float(o), 4)}
        for r, o, f in zip(rows, oof, flagged)
        if f
    ]
    print(f'B5: {int(flagged.sum())} negatives with out-of-fold score above {recipe["negatives"]["ignoreAbove"]} set to ignore')
    ok = keep & ~flagged
    auc = {}
    for z in recipe['zones']:
        s = ok & (zones == z['id']) & ~np.isnan(oof)
        if s.sum() and len(set(y[s])) == 2:
            auc[z['id']] = round(float(roc_auc_score(y[s], oof[s])), 4)
    print('out-of-fold AUC by zone (GBDT, before B5):', auc)

    Xt, yt = X[ok], y[ok]
    g = gbdt(recipe, seed).fit(Xt, yt)
    scaler, net = fit_mlp(recipe, seed, Xt, yt)

    model = {
        'format': 'marco-polo-pool-model/1',
        'features': list(names),
        'gbdt': export_gbdt(g),
        'mlp': export_mlp(scaler, net),
        'gbdtWeight': recipe['gbdtWeight'],
        'calibration': {},
        'thresholds': {},
        'meta': {
            'seed': seed,
            'recipeSha256': hashlib.sha256(recipe_bytes.replace(b'\r\n', b'\n')).hexdigest(),
            'zones': [z['id'] for z in recipe['zones']],
            'trainRows': int(ok.sum()),
            'trainPools': int(yt.sum()),
            'ignoredByB5': int(flagged.sum()),
            'oofAuc': auc,
            'licence': 'Trained on DGT Ortos2025 (CC BY 4.0), PNOA (CC BY 4.0 scne.es), IGN BD ORTHO (Licence Ouverte 2.0) and OpenStreetMap labels (ODbL); see ATTRIBUTION.md',
        },
    }
    out = a.out or os.path.join(a.work, f'model-seed{seed}.json')
    with open(out, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(model, fh, separators=(',', ':'))
    with open(os.path.join(a.work, f'b5-review-seed{seed}.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(review, fh, indent=1)
    # Reference scores for the TypeScript parity test: the first rows of each zone, both scorers and the blend.
    idx = []
    for z in recipe['zones']:
        idx += list(np.flatnonzero(zones == z['id'])[:40])
    ref = {
        'rows': [X[i].tolist() for i in idx],
        'gbdt': g.predict_proba(X[idx])[:, 1].tolist(),
        'mlp': net.predict_proba(scaler.transform(X[idx]))[:, 1].tolist(),
    }
    ref['blend'] = [blend(recipe, a_, b_) for a_, b_ in zip(ref['gbdt'], ref['mlp'])]
    with open(os.path.join(a.work, f'parity-seed{seed}.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(ref, fh)
    print(f'seed {seed}: model -> {out}, {len(model["gbdt"]["f"])} trees, MLP {[len(b) for b in model["mlp"]["biases"]]}')


FEATURE_NAMES = [
    'level', 'in_h', 'in_s', 'in_v', 'in_hsd', 'in_ssd', 'in_vsd', 'in_r', 'in_g', 'in_b', 'in_br', 'in_gr', 'in_bg',
    'in_strict', 'in_gate', 'in_tex', 'in_texfrac', 'log_area', 'fill', 'aspect', 'compact', 'extent_m', 'edge_grad', 'touches',
    'a_v', 'a_s', 'a_vsd', 'a_r', 'a_g', 'a_b', 'a_perm', 'a_green', 'a_deck', 'a_dark', 'a_tex',
    'b_v', 'b_s', 'b_vsd', 'b_perm', 'b_green', 'b_deck', 'b_dark', 'b_tex',
    'contrast_a', 'contrast_b', 'tile_v', 'tile_s',
    'obb_fill', 'obb_len_m', 'obb_wid_m', 'obb_aspect', 'court_dev', 'hole_frac', 'in_line', 'a_deck_min', 'b_vasym',
]

if __name__ == '__main__':
    sys.exit(main())
