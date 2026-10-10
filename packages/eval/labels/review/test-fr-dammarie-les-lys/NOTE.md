# test-fr-dammarie-les-lys

- Pass 1a (8 Oct, blind, 121 windows): 64 pools after the OSM merge.
- Pass 2 (10 Oct, blind, 25 windows by hash, another reviewer): F1 0.722 against pass 1a (13 matched, 1 only in pass 1a, 9 only in pass 2). Pass 1a missed pools.
- Pass 1b (10 Oct, blind, all 121 windows and all quadrants at 2x, a third reviewer who saw neither pass 1a nor pass 2): 110 pool boxes, 190 unsure.
- `pass1.json` is the union of pass 1a and pass 1b, window by window. Two independent blind passes miss fewer pools than one. Where one pass says pool and the other unsure, the box dedupe keeps pool.
- Union against pass 2: F1 0.944 (17 matched, 2 only in the union, 0 only in pass 2).
- Merged with the OSM verdicts of 8 Oct (`osm-check.json`): 98 pools inside the zone.
