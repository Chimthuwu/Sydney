# World-design prompt

> **How to use this document:** hand it, together with `data/world/world-spec.json`, to an AI agent that is going to design the city. It is written to be read by that agent. Everything it claims about Sydney is traceable to the spec; everything it asks you to invent is marked as invention.

---

## Your task

You are designing an open-world game city. You are being given the **geographic skeleton of a real city** - Sydney's inner core - as machine-readable data. Your job is to turn that skeleton into a convincing fictional city for a GTA-style open-world game.

**The goal is topology, not photography.** You are not reproducing Sydney. You are building a city that has Sydney's *spatial logic*: a harbour-wrapped commercial core, a compressed grid, a nightlife belt pushed out of the centre, park anchors, and a handful of crossings that everything funnels through.

---

## 1. What you are reading

Start with `data/world/world-spec.json`. Read these keys in this order:

| Read this | To understand |
| --- | --- |
| `evidenceLayers` | the four labels that separate fact from design. **Respect them.** |
| `coordinateSystem` | how to turn `local` coordinates into engine space |
| `scope` | the bounds of the data, and why this area was chosen |
| `totals` | the scale of what exists |
| `districts[]` | the 19 urban zones and how dense each one is |
| `roads.arterials[]` | the traversable skeleton, with geometry |
| `landmarks.crossings[]` | the bridges and tunnels that define the topology |
| `water` | the harbour, bays, rivers, beaches |
| `nature` | the park anchors |
| `transit` | where movement concentrates |
| `venues.byDistrict` | where commercial and nightlife activity actually is |
| `nightlifeClusters[]` | measured nightlife hotspots |
| `populationZones[]`, `gameplayZones[]` | **gameplay classifications, already made for you - see section 9** |
| `limitations[]` | what you cannot learn from this data |

Supporting files: `data/world/world-analysis.json` (interpretation - treat as a suggestion, not a fact), `world/districts.json`, `world/roads.json`, `world/venues.json`, `world/waterways.json`, `world/transit.json`, `world/parks.json`, `world/landmarks.json`, `world/buildings.json`.

Full-fidelity geometry for every road way, venue and building is in `data/normalized/`.

## 2. The coordinate system

Every `local` value is already in **metres**, in a local tangent plane centred on the CBD:

```
x = east,  y = up,  z = south
```

Three.js is Y-up, so a `geometryLocal` polyline `[[x, 0, z], ...]` maps directly onto a `BufferGeometry` on the XZ plane. `metersPerUnit` is `1.0`; if you want a smaller world, scale the whole thing uniformly - but **never scale x and z differently**, or the geography distorts.

`y` is always 0. This data has **no elevation**. Sydney's topography is not in OSM here. If your design needs hills, you are inventing them - label them as such.

## 3. Rules for what you may change

### Preserve (this is the city's DNA)
- **Relative geography.** Where the harbour is relative to the centre. Where the water wraps around.
- **Road relationships.** Which roads connect to which, which crossings exist, where the grid tightens and where it opens up.
- **District relationships.** Which district is next to which. Which is commercial, which is residential, which is the nightlife district.
- **Harbour placement, bridges, tunnels, major routes.**
- **Venue clusters.** If the data says 40 nightlife venues in one 400 m cell, that cell is the nightlife district. Do not scatter them evenly.
- **Park anchors.** Large parks are landmarks, not decoration. They stay large and they stay where they are.
- **Transport relationships.** Where stations cluster, where the ferry terminals are, where movement concentrates.

### Fictionalise (you must)
- **Every name.** Street names, business names, district names, landmark names. Do not ship "Barangaroo" or "George Street" as game content. Invent names with the right *character* (Sydney has convict-era, naval, Indigenous and 20th-century migrant layers to riff on) but do not copy.
- **Buildings and architecture.** Massing, style, signage.
- **Layout compression.** Distances can be compressed; relationships cannot be broken.
- **Landmark identity.** Keep the *role* - "the bridge that joins the north and south business districts" - and invent the landmark that plays it.

### Never
- Never invent a measurement and present it as data. If you need a number the spec does not have, derive it and mark it derived.
- Never fill a null height with a plausible number and leave it unmarked.
- Never claim a population level. See section 9.

## 4. Compression

Real inner Sydney is ~5-7 km across. A game city of that size is small. Compress aggressively:

- **Distances:** scale the whole world down uniformly, or shorten long arterials. Keep the *order* of magnitudes between districts.
- **Repetitive buildings:** the data contains 1,856 service roads and 1,515 local streets. You do not need every one. Keep the ones that define blocks and intersections; fill the rest procedurally.
- **Uniform grid:** the CBD grid is dense and regular. Compress it to a handful of representative blocks and let the player never know.
- **Never compress a crossing away.** The bridge and tunnel crossings are the topology. They survive at full fidelity.

## 5. Districts

`districts[]` gives you 19 zones with measured venue density, nightlife density, road length, park area and transit stops. Use these to assign each one a role. The data already suggests roles in `gameplayZones[]`.

What makes a good GTA city is **contrast between adjacent districts**. The data already shows this clearly:

- A dense commercial core with high venue density and high transit.
- A nightlife concentration that is *not* in the commercial core but immediately adjacent to it - the classic "you go out in the next suburb" relationship.
- Park anchors that are large, isolated, and connected by arterials rather than continuous green space.
- Waterfront districts that are touristy rather than residential.
- Sparse residential districts on the far edges.

Keep every district distinct. If two adjacent districts play the same, merge them or differentiate them.

## 6. Nightlife

`nightlifeClusters[]` is measured, not invented: nightlife venues binned into 400 m cells, keeping cells with 6+ venues. Each cluster has a real count and a real `venueCount`.

Use it as the spine of your night economy. For each cluster:
- Decide its character from `byCategory` - a cluster of `bar` and `pub` is a different place from one with `nightclub` and `casino`.
- Give it a **peak window** (`peakHours`). This is a game design choice; OSM does not have reliable opening hours. Label it as design.
- Connect it to the core by a route that a player can drive or walk in a reasonable time.

Note the measured reality: the densest nightlife is on the **edges of the core, not inside it**. That is the most valuable structural fact in this dataset. Do not flatten it.

## 7. Water, crossings and traversal loops

Sydney's identity is its relationship with water. From the data:

- The harbour is on multiple sides of the core.
- A small number of **crossings** (`landmarks.crossings[]`) are the only ways through. Each is derived from real bridge/tunnel road geometry and has drivable coordinates.
- Ferry terminals sit on the water; rail stations sit inland.

Design loops that exploit this:
- Waterfront circuits that use crossings rather than going around.
- Shortcuts that only exist because of a tunnel.
- Chokepoints where traffic funnels - these are your pursuit and ambush locations.
- A boat/ferry route between terminals that bypasses the road network entirely.

A city where the water is decorative will not feel like this city. The water should be the thing that makes routes expensive.

## 8. Building the world from this data

Practical order of work:

1. **Terrain/water first.** Union the water polygons into a land mask. Establish the coastline. Everything else depends on it.
2. **Roads second.** Build the road graph from `roads.arterials[]` (and the full list in `data/normalized/roads.json`). Use `intersections.major[]` to get the topology right at the junctions that matter.
3. **Districts third.** Cut the world into the 19 zones. Give each a role from `gameplayZones[]`.
4. **Landmarks and crossings fourth.** Place the big structures. Use the crossing positions as fixed anchors.
5. **Blocks and buildings fifth.** Only now. Use `venues.byDistrict` to place commercial frontage where the data says commerce is. Buildings are the least important layer - see the warning below.
6. **Transit last.** Stops are already positioned; decide what they do.

### Building heights - a hard rule

The spec's building layer is a **small sample**, and within it roughly 4 in 5 footprints have `building:levels` while almost none carry a real `heightM`. The rest are `null` on purpose.

You will want massing. That is fine - but derive it from **district character and your own design**, and mark it as invented:

```json
{ "heightM": 85, "heightSource": "design-inferred from CBD commercial zoning" }
```

never:

```json
{ "heightM": 85, "heightSource": "osm-tag" }
```

## 9. Population and gameplay zones - read the disclaimer

`populationZones[]` and `gameplayZones[]` are already in the spec. Read their disclaimers:

> *Gameplay classification derived from OSM feature density. It is not a measurement of real human population or foot traffic.*

This matters. A dense retail street in OSM means **lots of shops are mapped**, not that lots of people are there. A park with no venues means **no amenities were mapped**, not that nobody visits. Sydney's real daytime and night-time population is not recoverable from this data, and neither is footfall, crime, or noise.

Treat these zones as a starting point for NPC density that you will tune by feel. Do not present them as facts about the real city.

## 10. Preserve the fact/design boundary in your output

The discipline that makes this dataset useful is that the four evidence layers never blur. Carry it into whatever you produce:

| Layer | Where it lives in the spec | How to treat it |
| --- | --- | --- |
| Source fact | `provenance.source`, `tags`, `highway`, `levels` | reproducible, citable |
| Derived geography | `districts[]`, `intersections[]`, `crossings[]`, `nightlifeClusters[]` | computed from the source; trust but verify the method |
| AI interpretation | `data/world/world-analysis.json` | a suggestion; override freely |
| Gameplay design | `populationZones[]`, `gameplayZones[]`, anything you invent | yours; label it |

When you emit a design document alongside the city, tag your own fields the same way. A downstream agent should be able to tell, without asking, which parts of the city are Sydney and which parts are yours.

## 11. Checklist before you start building

- [ ] Water mask built, coastline fixed.
- [ ] Every district in `districts[]` has a distinct role.
- [ ] All major crossings from `landmarks.crossings[]` are present and drivable.
- [ ] The nightlife cluster with the highest `venueCount` is the nightlife district.
- [ ] The largest parks are still the largest parks, in the same places.
- [ ] Transit stops are where the data put them.
- [ ] **No real Sydney names appear anywhere in game content.**
- [ ] Every invented height, distance or count is labelled as invented.
- [ ] No population or footfall claim is presented as fact.
- [ ] The city can be summarised as: *"a harbour-wrapped commercial core with a nightlife belt next door,
      tied together by a few crossings and anchored by a few parks."*
      If your city cannot be summarised that way, you have lost the topology.
