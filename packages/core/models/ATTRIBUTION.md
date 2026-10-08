# pool-v2.json

The v2 pool scorer: gradient-boosted trees and a small neural network over
47 features of each candidate, with an isotonic calibration and a threshold
per imagery family. `tools/train` writes it (recipe `tools/train/recipe.json`,
seed 0); `packages/core/src/detect/model.ts` reads it. Its scores match the
Python models within 1e-5 (`packages/core/test/model.test.ts`).

## Training data

Candidates and features come from the product code (`marco-polo candidates`).
Labels are hand boxes from a blind review of 10 windows per zone, with the
OpenStreetMap outline where OpenStreetMap has the pool.

| zone | imagery | credit |
|---|---|---|
| Carvoeiro, Azeitão (PT) | DGT Ortos 2025, 25 cm | Informação geográfica cedida pela Direção-Geral do Território, Ortos 2025, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| Torrelodones, L'Eliana (ES) | PNOA máxima actualidad | Obra derivada de PNOA CC-BY 4.0 scne.es; the flight date of each area was not recorded, the tiles are the ones served in October 2026 |
| Carry-le-Rouet (FR) | IGN BD ORTHO (Géoplateforme ORTHOPHOTOS) | IGN, BD ORTHO, Licence Ouverte 2.0 (Etalab); tiles served in October 2026 |

Pool outlines: © OpenStreetMap contributors, ODbL 1.0
(https://www.openstreetmap.org/copyright). The OpenStreetMap Foundation
treats a training set drawn from OpenStreetMap as a derivative database and
asks that models trained on it say so; predictions made with the model are
not covered by the ODbL.

The calibration uses detections on the DEV zones and on the Pozuelo gold
zone (Esri World Imagery for Scottsdale, the open sources elsewhere). Esri
imagery is never used for training.

The model file is released with the rest of the repository under the MIT
licence, with the credits above.
