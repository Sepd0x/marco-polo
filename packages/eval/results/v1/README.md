# v1 baselines (8 Oct 2026)

v1 is `packages/core` as shipped, threshold 0.55. Every number has a 95% block
bootstrap interval in the report.

| run | zones | source | point rule | F1 |
|---|---|---|---|---|
| `esri-phase0-rule/` | the ten phase 0 zones | Esri | phase 0 | DEV 64.9% [59.4, 70.2], DEV-2 71.4% [67.6, 74.9]: the phase 0 table, exactly |
| `esri/` | DEV (with Braga) and DEV-2 | Esri | v2 | DEV 55.9% [50.3, 61.2], DEV-2 70.3% [66.5, 73.9] |
| `auto/` | DEV, DEV-2, GOLD | product source of each zone | v2 | DEV 29.0% [24.4, 34.0], DEV-2 48.6% [45.0, 52.7], GOLD 66.1% [60.0, 71.2] (8 Oct, after the absent lists of Aix, Balma and Vilamoura and the browser-exact JPEG decoder) |
| `test-partial/` | the TEST zones kept so far | product source | v2 | pt-rest (Viseu) 6.5% [1.5, 14.3]; negative (Dunkerque) 11 FP |

Read with care:

- `auto/`: the phase 0 hand labels were drawn on Esri. On DGT, IGN and PNOA
  they are moved by a measured shift (`labelShiftM`, phase correlation), but
  the review that marks pools absent from those sources
  (`labels/<zone>.absent.<source>.json`) covers Aix and Balma (IGN) and
  Vilamoura (DGT) only, so recall on the DEV-2 zones is a lower bound. On IGN
  the Balma labels also miss pools the imagery shows, so precision there is a
  lower bound too. The OSM shift per source is measured from confident v1
  detections (`osmShiftM`).
- v1 on the DGT makes hundreds of false positives per km² (Braga 435, Cascais
  384, Viseu 426): tree canopy in the washed-out Ortos2025 colours, as phase 0
  saw in Cascais.
- Braga on Esri uses a shift measured with a weak correlation peak (0.009) and
  no absent review: its Esri line is indicative only.
- `test-partial/` covers two of the seven strata and its labels lack the 20%
  second pass. It is not the TEST baseline; that run waits for the draw to
  finish (`results/TEST_ZONES.md`).
- GOLD labels are the phase 0 gold converted to boxes (the union of what the
  prototype methods proposed, checked by eye), so they have no OSM outline and
  no area error.
