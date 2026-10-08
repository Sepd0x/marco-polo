# Decode parity fixtures

Ten JPEG files, unchanged, fetched on 7 and 8 Oct 2026 from open-licence
sources. The name is `<source>-<place>-<z>-<x>-<y>.jpg`; DGT tiles are 512 px
WMS answers for a z18 tile, the others 256 px WMTS tiles at z19. The
`halo43` file is the same DGT tile asked for with a 43 px halo (598 px, a
size that is not a whole number of JPEG blocks), to test the decoder edges.

| Files | Source | Licence and credit |
|---|---|---|
| `dgt-ortos2025-*` | DGT Ortos2025, `Ortos2025-RGB` | Informação geográfica cedida pela Direção-Geral do Território (Ortos2025, CC BY 4.0) |
| `pnoa-*` | PNOA, IGN Spain, `OI.OrthoimageCoverage` | CC BY 4.0 scne.es |
| `ign-*` | IGN France, BD ORTHO (`ORTHOIMAGERY.ORTHOPHOTOS`) | IGN, BD ORTHO (Géoplateforme), Licence Ouverte 2.0 |

No Esri tiles: their terms do not allow redistributing them.
