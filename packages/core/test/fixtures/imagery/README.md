# Imagery fixtures

Tiles the sources send where they have no imagery, fetched on 7 Oct 2026.

| File | Source | Request | Licence and credit |
|---|---|---|---|
| `pnoa-outside-spain.jpg` | PNOA, IGN Spain (`OI.OrthoimageCoverage`, WMTS GoogleMapsCompatible) | one 256 px tile in mainland Portugal | CC BY 4.0 scne.es |
| `dgt-outside-portugal-512.jpg` | DGT Ortos2025 (`Ortos2025-RGB`, WMS EPSG:3857) | 512 x 512 GetMap over Madrid | Informação geográfica cedida pela Direção-Geral do Território (Ortos2025, CC BY 4.0) |

Both files are unchanged. The Esri placeholder is not kept here: its terms do
not allow redistributing tiles, so tests recognise it by its SHA-256 and read
the bytes only from a local research copy when one exists.
