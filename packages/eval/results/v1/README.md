# v1 baselines

v1 is `packages/core` as shipped before v2, threshold 0.55. Every number has a
95% block bootstrap interval in the report.

| run | zones | source | point rule | F1 |
|---|---|---|---|---|
| `report.json` | DEV, DEV-2, GOLD, TEST | product source of each zone | v2 | DEV 28.9% [24.6, 33.8], DEV-2 48.6% [45.0, 52.7], GOLD 65.8% [59.8, 71.0], TEST 37.0% [32.3, 42.2] (10 Oct, the baseline of the gate) |
| `esri-phase0-rule/` | the ten phase 0 zones | Esri | phase 0 | DEV 64.9% [59.4, 70.2], DEV-2 71.4% [67.6, 74.9]: the phase 0 table, exactly |
| `esri/` | DEV (with Braga) and DEV-2 | Esri | v2 | DEV 55.9% [50.3, 61.2], DEV-2 70.3% [66.5, 73.9] (8 Oct, labels before the Balma review) |

Read with care:

- `report.json` is the run the gate compares v2 with: same zones, same frozen
  labels (`labels.sha256`), same imagery per zone. v1 needs no
  `--confirm-test`, so it does not count against the three TEST runs.
- v1 on the DGT makes hundreds of false positives per km² (Braga 422, Viseu
  473, Mirandela 475): tree canopy in the washed-out Ortos2025 colours.
- Braga on Esri uses a shift measured with a weak correlation peak (0.009) and
  no absent review: its Esri line is indicative only.
- GOLD labels are the phase 0 gold converted to boxes, so they have no OSM
  outline and no area error.
