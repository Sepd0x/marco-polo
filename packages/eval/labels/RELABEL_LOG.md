# Label changes after a freeze

One entry per `--relabel`. Never edit past entries.

- 2026-10-08, commit 5c7e3a7, zones vilamoura, scottsdale, odemira, aix, balma, braga: absent review on the product source for aix and balma (IGN) and vilamoura (DGT): covered, enclosed or canopy-hidden pools listed in <zone>.absent.<source>.json; done by the detection flow after seeing its misses, not blind
  files: vilamoura.absent.dgt.json, aix.absent.ign.json, balma.absent.ign.json

- 2026-10-10, commit a585cc4, zones balma: blind pass over the whole zone on its product source (IGN), all 30 windows, with no labels and no detections in view; a second blind pass on 6 windows by hash agreed at F1 1.000 (44 matched). The labels were drawn on Esri; boxes matching no earlier label were added by eval blind supplement as drawnOn ign: 66 pools and 89 unsure in the windows. Done after the IGN threshold of the new model came out high on these labels.
  files: balma.extra.geojson

- 2026-10-28, commit 14e6d6a, zones large-pools: large-pool set for the v3 round: 78 outlines of 300 m² or more (39 of 400 m² or more, 3 ignore) in Albufeira, Quarteira, Orihuela Costa, Sanchinarro, Estepona, Cap d'Agde and La Grande Motte, each checked by eye at z19 on its product source (DGT, PNOA, IGN); OSM outlines kept, missing ones drawn; only 19 of 3709 earlier label outlines reach 400 m². A class of its own, never in the zone totals; no outline within 50 km of a TEST zone
  files: large-pools.geojson
