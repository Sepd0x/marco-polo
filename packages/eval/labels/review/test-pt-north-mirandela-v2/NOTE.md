# test-pt-north-mirandela-v2

- Pass 1a (10 Oct, blind, 100 windows): 69 pool boxes and 37 unsure, about 60 distinct pools. 15 windows have grey no-imagery areas over the river Tua.
- Pass 2 (10 Oct, blind, 20 windows by hash, a second independent blind pass): 16 pool boxes, 12 unsure. F1 0.897 against pass 1a with the old agreement rule.
- Pass 1b (10 Oct, blind, all 100 windows and all quadrants at 2x, a third blind pass that saw neither pass 1a nor pass 2): 75 pool boxes, 55 unsure.
- `pass1.json` is the union of pass 1a and pass 1b, window by window.
- Two of the three pools only pass 2 had were edge pieces of pools both full passes boxed whole in the neighbouring window; the old rule kept a first pass box only when its centre fell inside a second pass window. `blind agree` now matches first pass boxes that touch the second pass windows and counts an unmatched one only when at least half of it lies inside them. With that rule: F1 0.909 (15 matched, 2 only in the union, 1 only in pass 2, a large teal basin at the top of w-08-08 that neither full pass boxed).
- OSM: 6 pools, shift onto DGT 0.2, -0.6 m from 5 pairs; the one OSM pool not boxed shows no pool on the imagery (absent).
- Merged: 58 pools inside the zone.
