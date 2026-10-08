# tools/train

Training, calibration and the benchmark report of the v2 pool scorer. Python
3.14 on the CPU, versions pinned in `requirements.txt`. Nothing here computes
candidates or features: they come from the product code through
`marco-polo candidates`.

`recipe.json` is fixed before a run: training zones with the sha256 of their
labels, halo, augmented copies, augmentations, model sizes, the five seeds and
the seed that ships (0, chosen before training).

## Steps

```bash
# 1. labels and candidates of the 10 blind-reviewed windows of each training zone
npx tsx tools/train/prepare.ts --work <work> --cache <tile cache>

# 2. trees and network for one seed: <work>/model-seed0.json, uncalibrated
python -I tools/train/train.py --work <work> --seed 0

# 3. raw score of every detection on the calibration zones, hit or not
MARCO_POLO_MODEL=<work>/model-seed0.json npx tsx tools/train/calibrate.ts --out <work>/rows-seed0.json

# 4. isotonic map and threshold per imagery family; the shipped model and its parity reference
python -I tools/train/calibrate.py --rows <work>/rows-seed0.json --model <work>/model-seed0.json \
  --out packages/core/models/pool-v2.json \
  --parity <work>/parity-seed0.json --parity-out packages/core/test/fixtures/model-parity.json

# 5. DEV out of fold, DEV-2 and GOLD with the shipped model, GOLD as one mosaic too (P8)
npx tsx tools/train/report.ts --rows <work>/rows-seed0.json --uncal <work>/model-seed0.json \
  --python <python> --out packages/eval/results/v2
```

Calibration zones are the DEV zones of each family plus the Pozuelo gold zone
for PNOA. In step 5 each DEV zone is scored with a calibration fitted without
it, so no DEV number comes from a calibration that saw that zone. DEV-2 and
TEST are never used to calibrate.

## Checks

- `packages/core/test/model.test.ts`: the shipped file is the one the
  reference scores were written for (sha256), and TypeScript scores it like
  LightGBM and scikit-learn within 1e-5.
- The trainer refuses labels whose sha256 differs from the recipe, and
  feature names that differ from the detector's.

## Last run (8 October 2026)

52 978 training candidates, 6 818 of them pools; 104 confident negatives
ignored. DEV F1 out of fold for seeds 0 to 4: 73.7, 70.8, 74.2, 76.7 and 73.2
(mean 73.7, standard deviation 2.1).
