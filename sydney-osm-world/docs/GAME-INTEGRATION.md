# Sydney in the game

Real Sydney is playable in `grand-theft-bayou-main` behind `?sydney=1`.

```
node serve.mjs 8899      # then open http://localhost:8899/?sydney=1
```

The flag is off by default. Every save, test and playthrough without it is
completely unaffected.

## What is real

The ground you drive on is Sydney. It comes from OpenStreetMap through the
pipeline in `sydney-osm-world/`, sliced 1:1 to the 2400 x 2400 m map with no
scaling and no coordinate conversion — the projection already matches the game's
`world.js` convention (north = -Z, east = +X, metres).

| | |
|---|---|
| Tarmac | 149.5 km of real road centrelines, 2386 runs, **2 draw calls** |
| Traffic lanes | 2907 lanes over 194.7 km, 6614 junction links |
| Drivable network | 27.9 km in one connected piece; CBD, Western Distributor |
| Spawn | snapped to a real road at (-151, -480), the CBD |
| Build cost | 141 ms, zero network traffic at runtime |

The lanes are wired across junctions, not just drawn. `tools/qa/sydney_network_test.mjs`
walks the graph and asserts it, because a road network that is geometrically
perfect and gets nowhere looks exactly like one that works until you drive it.

## The city, not just the roads

The first playable version was a working Sydney street network with Louisiana's
entire world sitting on top of it — Chatboro's trailer parks and pine trees
standing in the CBD. Roads under foreign content does not read as an unfinished
city; it reads as a bug.

Louisiana's ~570 lines of world build (Chatboro, Ruston, OrleaRouge, Tusouxroe,
Shruston, Charsoufre, the Crown Strip, the state-wide expansion, Nolantis) are
now inside one `if (!SYDNEY_MODE)` block in `main.js`. Not hidden and not greyed
out — **not built**. Every placement in there assumes US-167 runs north-south at
`ROAD_X`; there is no such road in Sydney, so all of them were wrong.

Draw calls fell from 1407 to 428, which is the number that shows it worked: the
missing geometry was most of the frame.

Two things had to move to make that safe:

- The vehicle models (`carR`, `carB`, …) were loaded inside that block, and
  `createTraffic` needs them. They are now loaded above it, because both worlds
  drive the same cars.
- The minimap was built entirely from Louisiana district data, every layer
  guarded on a district that is `undefined` in Sydney — so the radar came up
  **blank**. It now takes `sydney.minimap`, the same centrelines the tarmac is
  built from.

Sydney's own content, all real OSM data, in `src/sydney/cityData.js` (generated
by `scripts/build_game_content.py`) and merged into four draw calls by
`src/sydney/content.js`:

| layer | what |
|---|---|
| harbour | 11 bodies, Port Jackson clipped to the map — 443,791 m² of water |
| parks | 15 — Hyde Park, the Domain, the Botanic Garden |
| buildings | 972 real footprints, heights from `levels`, tallest 130 m |
| districts | the 19 real neighbourhoods, for the HUD |

Buildings are a **sample**: OSM has 972 in the CBD bbox, which is the densest
and tallest part of the city and exactly where the player spawns. They carry the
skyline, not the whole city. Each also gets a collision circle, so the player
cannot drive through the CBD.

### The spawn was in a pit

George Street at the literal coordinates asked for sits **13 m from a 42 m
tower**, with 108 buildings inside 70 m and a 106 m one close by. The player
spawned in a pit with a wall of glass in front of them — technically the right
street, and the first thing anyone saw of Sydney.

So the spawn now scores road points on clearance from the nearest footprint, not
just distance. But the cure had to be measured against the city rather than
invented: across every road point within 350 m of the CBD, clearance peaks at
about **35 m** and most of it is under 20. The Sydney CBD is a genuine canyon.
An earlier version of this fix demanded 55 m of open sky and pushed the spawn
400 m out to the suburbs — trading a tight but real city street for an empty
field. `OPEN` is 24 m: enough to not be inside a wall, tight enough to stay in
the city. The spawn is now 69 m from the ask, on a real street.

## What is not real yet

- **Story mode is still Louisiana and should not be used in Sydney.** `Story`
  deliberately teleports the player to `PROLOGUE_START` in Chatboro and plays
  the opening cutscene; that content is now skipped in Sydney mode, so the
  campaign has no sets to run in. **`Free Roam` is the Sydney entry point.**
- The ground is flat. Real Sydney is not — the CBD ridge, the North Shore
  escarpment and Pyrmont's rise are all there. A height field cannot be invented
  from road geometry, and a faked one produces a city that is subtly wrong in a
  way that is much harder to debug than an honest flat plane. Terrain plugs into
  the `surface` seam in `src/sydney/world.js` when real elevation data arrives.
- The day cycle is frozen to a 19:30 dusk look for the whole day
  (`daycycle.js`), so a Sydney noon still looks like evening. That is the
  game's existing art direction, not a Sydney bug.

The Eastern Distributor is a separate network. It is an elevated motorway that
meets the surface only through its own ramps, and the closest those come to the
CBD network is ~290 m. It is wired internally; it is just not the same city yet.

## How it fits together

```
sydney-osm-world/scripts/build_game_roads.py
    -> src/sydney/roads.js          generated; do not hand-edit
       (centrelines + a table of where they meet)

src/sydney/buildLanes.js            centrelines -> traffic lanes, wired by geometry
src/sydney/roadSurface.js          tarmac + kerbs as one mesh, plus a road mask
src/sydney/world.js                 flat ground, spawn point, the assembly
src/traffic.js                      gained `nexts` and a spatial spawn grid
```

`buildLanes.js` derives the lane topology from the points themselves rather than
from the generator's junction table. The table has to agree with the lane
geometry on three things at once — which run, which end, which direction — and
any disagreement is silent. Pointing a lane at the wrong end of a run is a car
teleporting 200 m sideways; the worst version measured 341 m.

## Tests

```
node tools/qa/sydney_network_test.mjs    # the network is drivable (headless, fast)
npm run test:browser:sydney              # it loads and runs in a real browser
```

The browser test is the one that matters. A canvas can be present, correctly
sized and topmost in the DOM while rendering nothing at all, in which case a
screenshot shows the CSS background behind it — a picture of the title screen
that reads like a working city. It asserts on the game's own draw-call count
instead.

## Attribution

Road geometry, names and tags are © OpenStreetMap contributors, ODbL 1.0. Real
street names are retained. See `sydney-osm-world/ATTRIBUTION.md`.
