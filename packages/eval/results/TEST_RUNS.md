# TEST runs

Every run of a detector other than v1 on the TEST zones, logged before it starts (`--confirm-test`). At most 3. Never edit past rows.

| # | date | commit | detector | detector hash | targets sha256 | why |
|--:|---|---|---|---|---|---|
| 1 | 2026-10-10 | e676b20 | v2 | 62ba002bff612c30 | aa1b61fef052bcf814d68de1f9490082debea6b2384294731b7cb9f7462dc4ca | v2 release candidate: pool-v2.json d9c3672b29ae (court and shadow features, B6 thresholds out of fold) against v1 at 0.55 |
| 2 | 2026-10-28 | d90e434 | v2 | 3c2289a04d3bcf40 | aa1b61fef052bcf814d68de1f9490082debea6b2384294731b7cb9f7462dc4ca | v3 release candidate: pool-v2.json 715946884a6e (scaled size copies for pools of 400 m² and more, no Esri calibration, sine fix), half of the second ring in the area, one detection per shape seen by two tiles, merger index fix; justified on DEV (F1 79.9 to 80.6, signed area -12.2% to -2.0%) and DEV-2 (F1 74.6 to 74.3, signed area -22.2% to -14.5%) and the large-pool set (14 to 29 of 40); against v1 at 0.55 rerun on the same code |
