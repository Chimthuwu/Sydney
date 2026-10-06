# Transit — the streetcars, the regional line, and the freight spur

Status: **design sketch.** Nothing here is built yet. It exists so that when
somebody does build the first car, they are not inventing the gauge, the stop
spacing and the wire height on the fly, and so that the road work already in
`src/` does not quietly paint over a reservation it did not know about.

---

## 1. What is already in the world

Measured, not assumed:

| Thing | Value | Where |
| --- | --- | --- |
| World extent | ±1200 m in x and z | `src/stateWorld.js` `STATE_BOUNDS` |
| OrleaRouge city | x −136…680, z 196…500 | `src/orlearouge.js` `CITY` |
| OrleaRouge avenues | 19 north–south lines, −86…674, 40 m pitch | `AVENUES` |
| OrleaRouge streets | 7 east–west lines, 210…450, 40 m pitch | `STREETS` |
| Street width | 9 m (`STREET_W`), blocks 7 m back each side | `src/orlearouge.js` |
| US-167 arterial | x = −6, 10 m of tarmac (`ROAD_HALF` 5) | `src/main.js` |
| Avenue gap | the only 80 m gap in `AVENUES` is −46…34 — that is the boulevard | `AVENUES` |
| Metro (Downtown Bayou) | x −292…292, z −132…128 | `src/metro.js` `METRO_BOUNDS` |
| Metro streets / avenues | z −108, −52, 4, 60, 112 / x ±168 | `STREETS_Z`, `AVENUES_X` |
| Metro road widths | 10 m streets, 12 m avenues, four lanes each | `STREET_ROAD`, `AVENUE_ROAD` |
| East arterial | x 674 → 1180 at z 348, four lanes on a 0.4 m median | `src/orleafeinge.js` `EAST_HWY` |
| Other districts | Charsoufre ±130/z ±150, Shruston x ±130 z −300…310, Chatboro x −96…48 z −120…100, Tusouxroe x −130…172 z −572…−12, Wonders x 440…1060 z −340…380 | each module's `BOUNDS` |

Things that are *not* transit and must not be mistaken for it: `nolantis.js`
has a monorail ring because it is a theme park; `welcomeback.js` has a
decorative freight train on the refinery back fence. Both are one-shot set
pieces, not networks.

The important consequence of the table: **both downtown grids are regular.**
OrleaRouge is a 40 m lattice, Metro is a 56 m lattice, and every one of those
lines already has a full-width paved carriageway. A streetcar reservation is
therefore not new road. It is *paint, a rail groove and a wire* on tarmac that
already exists. That is the whole reason this is affordable.

---

## 2. What kind of transit, and why not "trains"

The obvious first instinct is railway. In Louisiana that is the wrong answer,
and being wrong here is expensive, because the map is named after the place.

The state never had a passenger railway. New Orleans did have streetcars — the
St. Charles green line down the avenue of live oaks, the Canal red line, the
Riverside orange line — and all of them died in the 1960s when the buses got
better. So a world that grew up as New Orleans grew up has exactly two kinds
of rail, and only two:

1. **Streetcars.** Slow, 25 km/h, overhead wire, a rail set flush in the middle
   of a street that cars also use. This is the fabric of the city.
2. **A short regional line.** One line out into the parish, on its own
   formation, built because the freight moved. This is the drama.

So: streetcars as the spine, one regional line as the payoff, and a freight
spur that is both the reason the regional line exists and the first job you
are offered on it.

---

## 3. Geometry that everything else hangs off

Fix these now; changing them later moves every rail, wire and platform.

- **Gauge 1.435 m**, centre of rail to centre of rail. Standard, and the only
  gauge the rolling-stock kits in `Z:\GITHUB\_ASSETS` were modelled at.
- **Rail section** 0.07 m wide, 0.16 m tall, top of rail **0.0** — flush with
  the tarmac, not on it. Grooved (flangeway) track: the 0.04 m groove is a dark
  strip in the tarmac and the railhead is a 0.07 m strip beside it. A raised
  rail 0.16 m proud is a tripping hazard and, in a game where the player walks
  everywhere, an obvious lie.
- **Track centreline sits on the street centreline** — `z = STREET[i]` or
  `x = AVENUE[j]` exactly — because the street centreline is where the tarmac
  is widest and the blocks are furthest away. The reservation is the middle
  5.2 m of the carriageway.
- **Overhead wire at 5.6 m** above rail, one contact wire, one messenger
  wire 0.9 m above it, hung on span wires every 12 m from a bracket on the
  existing lamp pole. Not masts: masts are a second thing to build along every
  street, and the lamp posts are already there at 40 m spacing.
- **Car**: 12.2 m long, 2.44 m wide, 3.1 m to the roof, four double doors,
  a trolley pole or a pantograph. 2.65 m of body over 1.435 m of gauge is the
  ratio that makes a streetcar look like a streetcar; a 2.4 m body on that gauge
  looks like a toy train, and a 2.9 m body looks like a bus on skates.
- **Minimum curve radius 12 m** (car centres). This is the number that decides
  whether the line can turn a corner: at 12 m a car overhangs about 2 m, so a
  90° turn needs 12 m of radius and 14 m of square. OrleaRouge's 40 m pitch
  gives 18 m of clear space at a crossing, which fits.
- **Stop spacing 220–400 m in the city, 700–1200 m in the parish.** Under
  200 m and a streetcar stops faster than a car drives past it.

---

## 4. Line 1 — the green line (St. Charles)

The oldest line, down the avenue of oaks, and the one a player will ride
first. Runs east–west across OrleaRouge on the middle street of each pair,
because OrleaRouge's seven `STREETS` are the only continuous lines in the
district.

Route, on the real grid — every coordinate below is a value that already
exists in `src/orlearouge.js`:

```
x = −126, z = 370   Canal Street terminus (west end, by the Quarter)
  → east on z = 370, x −126 → 674
  → left, north on x = 434, z 370 → 250
  → left, east on z = 290, x 434 → 674
  → left, north on x = 594, z 290 → 210
  → terminus, Carondelet at the civic end
```

Length about 1.9 km. Eleven stops, spaced 150–260 m, each one a raised
platform kerb 0.15 m proud, 18 m long, outboard of the rail so the car door and
the platform line up (0.35 m from car centre to platform edge on a 1.22 m
half-width car — measure this against the actual rig when the car exists, do
not trust this paragraph).

**Why it turns three times and does not go straight.** A streetcar that runs
one straight line through a 40 m grid is a line that only serves the four
blocks it happens to pass. The turns are where the demand is: a corner is the
only place on the network where two lines can meet, and therefore the only
place worth a stop. Every future interchange is chosen at a turn.

## 5. Line 2 — the red line (Canal)

North–south, on the west side, tying the French Quarter and the Jackson Square
reserve to the green line at two points.

```
z = 190, x = −46   north end, at the lake
  → south on x = −46, z 190 → 450
  → east on z = 450, x −46 → 154
  → terminus, riverbend
```

Both lines run on `x = −46`, which is the first `AVENUE` east of the Quarter
and the last one before the 80 m gap at US-167. Putting the red line on the
avenue nearest the old city, and the green line on the two cross-streets
either side of the Superdome reserve, keeps both lines out of the
`RESERVES` footprints — the Superdome (`x 420…680, z 200…460`) is the trap
here, and a line that clips it is a line that has to be re-routed.

## 6. Line 3 — the regional, out to the parish

The one that is not a streetcar, and the reason the whole thing is worth
building. Called the **Bayou Line**, and it exists to haul the refinery's
output, which is exactly the freight that `welcomeback.js` is already watching
go past on a fence.

- **Formation**, not street running, from the outset. Ballast, 4.4 m to rail
  head, so it reads as railway at two hundred metres.
- **Route**: leaves OrleaRouge at the east end of the green line, runs east on
  the `EAST_HWY` alignment (z 348) to x ≈ 900, then turns south-east across
  open ground to the refinery, which is the `welcomeback.js` montage at
  x ≈ 142, z 165…275.
- **The trestle.** 600 m of it over the swamp between x 700 and x 1300, on
  timber bents at 6 m centres, deck at 7.2 m. This is the landmark: it is
  visible from the east arterial, so the player sees the railway *before* they
  can reach it, which is the cheapest way in the whole design to make the
  world feel bigger than the part of it you have unlocked.
- **Rolling stock**: a road switcher (diesel, so no wire out here — the wire is
  a streetcar thing and a 4 km trolley wire across a swamp is a bridge with no
  bridge), four tank cars, a boxcar, a flatcar.
- **One station**: `Port Calypso` freight yard, with a spur, a loading gauge and
  a signal.

**The first job**: the refinery has product that has to leave before someone
else's truck gets onto the spur. Ride the regional, ride it back, get paid.
That is a mission that only exists if the train runs, which is the point.

## 7. Freight

The spur, the yard and two boxcars, reusing the tank/box/flatcar shapes from
`welcomeback.js` so the refinery still looks like the same railway it always
was. Freight is also the *cover* for the regional line in fiction: it predates
the streetcars by thirty years, it explains the embankment through the parish,
and it gives the player a reason to walk to the yard that has nothing to do
with the car they are driving.

## 8. How it attaches to the game

```js
// proposed src/transit.js
export const LINES = [ { id: "green", gauge: 1.435, stops: [ {x, z, name}, … ], route: [ [x,z], … ] } ];
export function createTransit(ctx) {
  return {
    build(),            // rail grooves, wire, platforms, stop furniture, into ctx.scene
    flushMarkings(scene),  // shares ctx's createMarkings() — never its own batch
    stops,              // flat, for the minimap and for save/load
    update(dt, state),  // car motion, doors, bells, hazard lights
    nearestStop(x, z),
    board(actor, stopId),   // → a ride
    alight(actor, stopId),
  };
}
```

The non-negotiables, from things that have already gone wrong in this repo:

- **Share the markings batch.** `flushMarkings()` takes the same
  `createMarkings()` the roads use, for the same reason the fringe does: a
  second batch is a second draw call for the whole network.
- **Stop placement is measured, not eyeballed.** A 0.35 m gap is invisible in a
  screenshot and is the difference between a door that opens onto a platform and
  a door that opens onto a kerb you have to step over. Write the measurement
  into `tools/qa/transit_test.mjs` the day the car exists.
- **Do not let traffic drive over the rail.** Cars on a streetcar street need
  either a signal (stop at the intersection when a car is coming) or a
  crossing warning. `makeRoadway` in `src/traffic.js` already knows about lane
  geometry; the cleanest version is a `reservation: true` flag on the roadway
  and a car that queues behind. Whichever way it goes, a car parked on a rail
  is the same class of bug as the bollards that once blocked the east
  arterial's running lane — and that one is now a regression test.
- **Stop at markers, not in the lane.** A streetcar stop needs a boarding
  island, and the island is a blocker. Put it outboard of the 5.2 m
  reservation so it never narrows a running lane.

## 9. Ordering, and what each step proves

| # | Step | Proves |
| --- | --- | --- |
| 0 | `tools/qa/road_ends.mjs`, finished properly | where the network can actually run — you cannot route a railway across a gap the survey already found |
| 1 | One 200 m of grooved rail + wire on one OrleaRouge street, no car | that flush track reads as track and does not z-fight the tarmac |
| 2 | The green line's full route, static | that the 40 m lattice turns on the radii in §3 |
| 3 | One moving car on the static route | motion, and the traffic conflict in §8 |
| 4 | Platforms, stops, boarding | the 0.35 m, which is the real test |
| 5 | Red line + the two interchanges | that a network is more than a line |
| 6 | Regional formation, trestle, yard | the reason the world is allowed to look big |
| 7 | Freight + the mission | the gameplay the whole thing is for |

Steps 1 and 2 are geometry. Step 3 is the first one that can be wrong in a way
a screenshot catches, and step 4 is the first one a player notices if it is
wrong. Do not skip 4 to get to 6.

## 10. Things deliberately not in the sketch

- **No underground.** A subway needs a tunnel, a station box and a lighting
  rig, and it is invisible 90% of the time you are in it.
- **No third rail, no electrification outside the city.** The wire is a
  streetcar's problem and a streetcar's problem is 1.5 km.
- **No freight the player drives.** A locomotive you can get in the cab of is
  a physics problem; a train that runs itself and either delivers or does not is
  a timetable and a trigger.
- **No commuter rail into the suburbs.** One regional line, or none. Three is a
  railway, and a railway is a different project.
