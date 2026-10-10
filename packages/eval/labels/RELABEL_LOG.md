# Label changes after a freeze

One entry per `--relabel`. Never edit past entries.

- 2026-10-08, commit 5c7e3a7, zones vilamoura, scottsdale, odemira, aix, balma, braga: absent review on the product source for aix and balma (IGN) and vilamoura (DGT): covered, enclosed or canopy-hidden pools listed in <zone>.absent.<source>.json; done by the detection flow after seeing its misses, not blind
  files: vilamoura.absent.dgt.json, aix.absent.ign.json, balma.absent.ign.json

- 2026-10-10, commit a585cc4, zones balma: blind review of the whole zone on its product source (IGN), all 30 windows, by a reviewer who saw no labels and no detections; a second blind pass on 6 windows by hash agreed at F1 1.000 (44 matched). The labels were drawn on Esri; boxes matching no earlier label were added by eval blind supplement as drawnOn ign: 66 pools and 89 unsure in the windows. Done after the IGN threshold of the new model came out high on these labels.
  files: balma.extra.geojson
