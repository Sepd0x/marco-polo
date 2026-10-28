# Label data: attribution and licence

`<area>.geojson` files are extracts of OpenStreetMap: features tagged
`leisure=swimming_pool` (ways, multipolygon relations and points), with
building footprints used only to flag pools that sit inside a building.

**© OpenStreetMap contributors.** The data is available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).
See <https://www.openstreetmap.org/copyright>.

`<area>.extra.geojson` files are hand-checked additions and corrections made
for this benchmark by looking at Esri World Imagery at z19. Because they are
used together with the OSM extracts (and some of them carry OSM geometry to
override an OSM feature), they are distributed under the same licence, ODbL 1.0.

`large-pools.geojson` holds outlines of pools of 300 m² or more, checked
by eye at z19 on DGT Ortos2025, PNOA and IGN BD ORTHO: OpenStreetMap outlines
where OSM has the pool, hand-drawn ones where it does not. It is distributed
under the ODbL 1.0 as well.

The rest of this repository is MIT; the ODbL covers only the files in this
folder.
