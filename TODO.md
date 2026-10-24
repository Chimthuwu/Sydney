# Grand Theft Sydney - TODO (branch `sydney`)

> **2026-10-07: this folder is now its own standalone repo (`Sydney`), no longer a worktree of Grand Theft Bayou. The OSM pipeline lives in `sydney-osm-world/` inside it.** The older notes below about the `sydney` branch/worktree describe how it was before.
>
> This is the **Sydney** task board. It lives on the `sydney` branch of the Grand Theft Bayou repo (worktree folder
> `GAME · GRAND-THEFT-SYDNEY`): Sydney is a mode of the Bayou engine (`?sydney=1`), so its tasks edit engine files
> (`src/main.js`, `src/world.js`, `src/npc.js`, `src/police.js` ...) plus the Sydney-only code in `src/sydney/`.
> The Bayou board that was here is preserved as `docs/BAYOU-TODO.md`. **When merging `sydney` into `main`, keep main's
> `TODO.md` and move this file to `docs/SYDNEY-TODO.md`.**
> Recovered 2026-10-06 from the old fresh-copy board; the Sydney hooks in `src/main.js` / `src/traffic.js` were ported
> onto the current Bayou engine by 3-way merge (base e6f4c18). Re-verify before trusting: nothing has been run in a browser.
> Pipeline/data project (OSM, 149 km roads): `Z:\github\TOOL · SYDNEY-OSM-WORLD`.

---

# TODO.md — live task board

> What are we doing? This file.
> How do we work together? [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md).
> What did we discover, decide or hand over? [`AGENT_LOG.md`](AGENT_LOG.md).
>
> **Rewritten 2026-09-30.** The previous 6,362-line append-only board is archived
> verbatim at [`docs/archive/TODO-2026-09-30.md`](docs/archive/TODO-2026-09-30.md).
> Its task history (TASK-001 … TASK-088), the per-session findings and the test
> history are all still there — this board does not replace that record, it is the
> short list of what is actually open now. Anything carried over below is marked
> **carried over** and needs re-verifying before it is trusted: the old board was
> append-only, so its open items were never reconciled against what later got built.

---

## Status legend

`BACKLOG` · `READY` · `IN PROGRESS` · `BLOCKED` · `REVIEW` · `COMPLETE` · `CANCELLED`

---

## Current focus: make Sydney playable, then build it out of real assets

Reported by the human, 2026-09-30, after a session in `?sydney=1`:

> *"a lot of the buildings are like missing a wall"*
> *"a lot of invisible walls — it was basically unplayable, but perhaps that's to be expected"*

**It is not expected.** Both halves are real defects with measured causes, and they
compound: half the city is invisible (002) while **all** of it is solid (001). You
drive toward a building you cannot see and stop against nothing.

Then the bigger ask: build Sydney out of the model packs in `Z:\GITHUB\_ASSETS`, the
way Louisiana is built (003). Most of those models are **already extracted into
`assets/models/` and referenced by nothing** — see
[`docs/SYDNEY_ASSET_WORKFLOW.md`](docs/SYDNEY_ASSET_WORKFLOW.md) for the pack
catalogue and the step-by-step plan.

**Suggested order for the next session: 001 → pick the look → 003 → the water/parks
half of 002.** (2026-10-07: TASK-SYD-005 below is the checklist of every Bayou mechanic Sydney should end up with; it is a backlog, not the next step.) Do not fix prism winding; 003 deletes the prisms.

---

## 🔴 TASK-SYD-001 — Sydney's collision is a circle per building, and the circles are enormous

**Status** READY · **Priority** highest — this is what made it unplayable
**Files** `src/sydney/content.js` (collider emission) · `src/world.js` (blocker registration)
**Tests** extend `tools/qa/sydney_content_test.mjs`

Every building registers **one circle**, sized as the maximum distance from its
centroid to any footprint vertex — a circle that *circumscribes* the footprint. The
code comment concedes the trade ("close enough at car speed, and one circle instead
of a convex hull"). Measured against the real data, that is not close enough:

| | |
|---|---|
| area blocked by the collider circles | **2.03 km²** |
| area of the actual building footprints | 0.76 km² |
| overshoot | **2.7×** |
| the map is 2400 × 2400 m | 5.76 km² — so **35% of the entire map** is solid |
| in whole 80 × 80 m CBD blocks | **≈ 317 blocks of invisible wall** |

Worst offenders, by circle-area ÷ footprint-area:

| radius | real footprint | blow-up | note |
|---|---|---|---|
| 19 m | 13 m² | **86×** | spiky / L-shaped ring, circle swallows the street |
| 13 m | 12 m² | 43× | |
| 22 m | 44 m² | 34× | |
| 17 m | 32 m² | 28× | |
| 38 m | 295 m² | 15× | |

The pattern is concave, boomerang or L-shaped footprints — exactly the towers that
make a city read as a city. The circumscribing circle is worst precisely where the
architecture is interesting, and it eats the sidewalks and corners around it.

**Fix direction:** the blocker system in `src/spatial.js` is a uniform grid of
circles, so circles are the cheap answer — but the radius must come from something
that actually bounds the shape. Options, roughly in order of effort:
- [ ] per-footprint **edge circles** (one per edge, radius = half the edge length) — still circles, still cheap, hugs an L-shape far better than one big one
- [ ] decompose concave footprints into convex pieces, one circle each
- [ ] if the spatial layer can be taught a convex hull or a segment, use the real polygon
- [ ] measure the *unblocked* street area against the road network afterwards and assert it recovers

**Acceptance criteria**
- [ ] blocked area within ~1.2× of real footprint area (from 2.7×)
- [ ] every lane in `buildLanes.js` is drivable end to end with no blocker on it — this is the real test, and `tools/qa/sydney_network_test.mjs` already walks the graph
- [ ] a driving pass along George Street does not snag on invisible walls
- [ ] no regression in Louisiana mode

---

## 🔴 TASK-SYD-002 — Half of Sydney's buildings render inside-out

**Status** READY · **Found** 2026-09-30 from a CBD screenshot
**Files** `src/sydney/content.js` (the whole fix) · **Tests** `tools/qa/sydney_content_test.mjs`
**Symptom:** buildings look like open boxes — you see through the wall facing you and
into the interior. A lot of them read as "missing a wall" rather than as buildings.

**Measured, not guessed.** Every real footprint run through the exact index emission
in `buildingGeometry()`, each wall normal checked against its own footprint centroid:

| | count |
|---|---|
| footprints total | 972 |
| walls face **outward** (correct) | 470 |
| walls face **inward** (inside-out) | **497** |
| degenerate (zero area) | 5 |

**51% of the city is inside-out.** The material is the default `FrontSide`, so the
near walls of those 497 are back-face culled — you look straight through them —
while the far walls draw from the inside. The roof is culled the same way, so from
above you see down into the box.

**Root cause:** ring winding is never normalised. `buildingGeometry()` walks `fp` in
whatever order the pipeline emitted and emits quads in a fixed order, so the facing
depends entirely on the sign of the footprint's signed area. Over the real data 497
rings are positive-area and 470 negative, and the two groups get opposite facings.
`triangulate()` in the same file *does* normalise winding (reverses when
`signedArea < 0`) — `buildingGeometry()` just never copied that.

Three further defects in the same function, worth fixing together:

1. **Every footprint repeats its first point as its last** (972 of 972). The wall
   loop closes with `j = (i + 1) % n` over that duplicate, so each building emits
   one zero-area quad and the roof fan counts a phantom vertex. `n` is one larger
   than the real vertex count, and any fix indexing off `n` inherits the error.
2. **367 of 972 footprints are concave, and the roof is a triangle fan.** The code
   comment claims "footprints are small and near-convex" — the data disagrees. On
   those 367 the fan throws triangles outside the footprint, over the neighbouring
   building and into the air. `triangulate()` (ear clipping) is already in this
   file and is not being used here.
3. **`computeVertexNormals()` smooths the wall corners.** Adjacent wall quads share
   footprint vertices, so their normals average and every building has soft, rounded,
   pillow-like corners instead of crisp architectural edges. This is the other half
   of what the screenshot shows. Roofs escape it — they have their own vertices —
   which is why the tops look flat and correct while the walls do not.

**Also affected, same cause, not yet checked in a browser:** `polygonGeometry()`
builds the harbour and the parks with `triangulate()`, which forces rings to
*positive* area — and a positive-area ring at fixed `y` emits a **downward** normal
(verified: `normal.y = -1.00` on a positive-area square). Both layers are therefore
back-face culled from above. The water also sits at `WATER_Y = -0.45`, below the
ground plane, so it may be hidden twice over. Confirm on screen before changing.

**Acceptance criteria**
- [ ] 0 of 972 footprints produce inward-facing walls
- [ ] duplicate closing point handled, no zero-area triangles
- [ ] concave footprints roof via `triangulate()`, 0 triangles outside the footprint
- [ ] wall normals flat per face — corners read as corners
- [ ] water and parks face up and are actually visible from above
- [ ] Louisiana mode visually unchanged

**Note the interaction with 001:** fixing 002 alone will make the invisible walls
*more* obvious, because solid collision will no longer be explained by a building
you can at least half see. Fix both.

---

## 🟡 TASK-SYD-003 — Build Sydney out of real asset packs, the way Louisiana was built

**Status** READY — plan written, nothing built yet · **Requested by** the human, 2026-09-30
**Assets** `Z:\GITHUB\_ASSETS` (the folder is `_ASSETS`, with a leading underscore)
**Full plan** **[`docs/SYDNEY_ASSET_WORKFLOW.md`](docs/SYDNEY_ASSET_WORKFLOW.md)** — pack
catalogue, the footprint→model mapping, baking, batching and the QA gates. Read that
before starting; this is only the summary.

> *"I would wanna use the assets I have saved in like my `Z:\GITHUB\_ASSETS` folder
> for some of the buildings so we can do something similar to what we did in
> Louisiana to build the city."*

Louisiana places real GLB/FBX/OBJ models from `assets/models/` and dresses districts
around them. Sydney currently has **972 extruded OSM prisms in one flat-shaded
material** — geometrically right, visually a grey field. This task swaps the prisms
for actual building models, keeping the OSM footprint as the source of truth for
placement and collision.

### The headline: most of this is already in the repo, unused

| `assets/models/` | holds | status |
|---|---|---|
| `voxel_buildings/` | **all nine** voxel buildings, as `.obj` + `.mtl` + `.png` — `Tiny_Building`, `Small_Building_01`–`04`, `Large_Building_01`, `Tall_Building_01`–`03` | **extracted and complete, referenced by nothing in `src/`** |
| `buildings/Buildings.glb` | the `Buildings.rar` pack | in use by Louisiana, known-good |
| `urban/` | `Pavement`, `Pillar`, `Road`, `Roof`, `Stair`, `Streetlamp`, `Wall`, `Window` | in use by Louisiana |

So the session is **placement code, not asset wrangling**. The only pack that has to
come across is `Downtown City MegaKit[Standard].zip` (224 MiB, FBX, modular downtown
— brick pieces, columns, trim), and pulling that across is a decision, not a chore.

### What is in the library

`Z:\GITHUB\_ASSETS\INDEX.md` is the full index; the catalogue is tabulated in the
workflow doc. The relevant ones:

- `3D/Buildings-Voxel/` — Small 01–04, Tiny, Large 01, Tall 01–03, plus
  `VoxelShopBuildings.zip` (two shop buildings, a phone cabin, a parked car, a ground
  tile). One coherent low-poly faceted style across all nine.
- `3D/Buildings-Shops/free city pack.zip` — benches, signs, hydrant, traffic light.
  **Sydney has no street furniture at all right now.**
- `3D/Roads-Infrastructure/` — `[FREE] Modular Roads - Base.zip`, `Urban_Modular_Demo.zip`.
- `3D/Buildings-Shops/TownTileSet.zip` — textured town tile with day/night textures.
- The Louisiana shop kits (`6twelve`, `Gas_station`, `Tacos`, `BurgerPiz`,
  `Pizzeria`, `Quequis_House`, `Trailer_Park`, `Bus_stop`) are American storefronts —
  **not** candidates for Sydney. `Sewer.rar` is the exception; the Louisiana story
  ends in a storm-drain escape and Sydney would too.

### How this changes the other two tasks

- **001 (collision) is unaffected and still comes first.** It does not care how the
  mass is drawn. Fix it before the session so there is something drivable to judge
  the rest by.
- **002 (inside-out prisms) is largely mooted.** If the prism mesh is deleted, the
  winding bug goes with it. The water/parks half of 002 is *not* mooted.

**Suggested order: 001 → pick the look → 003 → the water/parks half of 002.**
Do not spend the session fixing prism winding; 003 deletes the prisms.

### Decide first, build second

- [ ] **The look — this blocks everything else.** Voxel set, MegaKit, or a mix? The
      voxel models are stylised and faceted; the MegaKit is modular and detailed;
      `graphics.js` runs a photoreal HDR pipeline (derived PBR maps,
      GTAO → bloom → tone map → filmic grade → SMAA) around all of it. A stylised
      voxel house beside a detailed brick tower in a graded frame may look worse
      than either alone.
- [ ] The mapping: 972 footprints → ~9 models, bucketed by height, fitted by uniform
      scale and rotation, seeded so the city is byte-identical on every reload.
      Specified in the workflow doc.
- [ ] Prisms: deleted, or kept as a low-detail proxy under the models?
- [ ] Draw calls: the city is one mesh now. Nine models batched through `merge.js`
      should collapse back to a handful, but the ~4.5k budget has to be re-checked.
- [ ] Confirm real model dimensions in metres — the pack listings do not give them,
      and more than one pack is likely authored in centimetres.

## 🟡 TASK-SYD-004 — Strip the American-only content out of Sydney

**Status** BACKLOG · **Requested by** the human, 2026-09-30
> *"We need to also remove the hogs, the police, the NPC voices (since they all
> American) and yer."*

None of this belongs in Sydney. The Louisiana world and its content are shared
modules, so this is mostly a matter of **gating by world**, not deleting anything —
`src/sydney/world.js` is already a drop-in seam that `main.js` calls instead of the
Louisiana builder.

- [ ] **Hogs** — `src/npc.js` spawns them in fields and woods. No hogs in Sydney.
- [ ] **Police / sheriffs** — `src/police.js`. Real Sydney has real police; decide
      whether that means an Australian set, no police at all, or leave for later.
      Do not simply delete the module.
- [ ] **NPC voices** — the voice lines are American English and were generated with
      a Fish Audio key. Needs an Australian voice set, or silence, or subtitles only.
      Affects `tools/voiceover-gen.mjs` and the ambient chatter.
- [ ] **…and the rest of the American layer** — the human said "and yer", so sweep
      for the rest rather than stopping at three: US-167 signage, the dollar, the
      American store brands on the strip (6twelves, BurgerPiz, Popeyes), the
      accent in written barks, phone/vehicle signage, the sheriff's cruiser.
- [ ] Make the gate explicit and testable: one `SYDNEY_MODE` check that asserts
      none of the above are in the scene, rather than a scattering of `if`s.

**Do not remove these from Louisiana.** The gate must be a world flag, not a deletion.

---

## 🟢 TASK-SYD-005 — Bring every Bayou mechanic to Sydney (except the US-only ones)

**Status** BACKLOG · **Requested by** the human, 2026-10-07 · **Written by** Claude from a read of the Bayou engine (`src/*.js`, README, Bayou TODO), nothing run
> *"update the Sydney repos todo to include all mechanics that gtaBayou has (except anything that's exclusive to USA/America)"*

Sydney is a mode of the Bayou engine (`?sydney=1`), so most mechanics are **already in the shared modules** and only need to
be (a) switched on / not gated off in Sydney, (b) given Sydney data (coordinates, venues, names, voice, currency), and (c) verified,
because **nothing has been run in a browser on this branch**. Three kinds of item below:

- **ENGINE** — lives in a shared module. Action = enable under `SYDNEY_MODE`, verify it works on the OSM world, no rewrite.
- **RESKIN** — the mechanic stays, the American flavour goes (names, brands, accent, props).
- **NEW FOR SYDNEY** — the mechanic needs Sydney-specific content built.

Do **not** remove anything from Louisiana; gate by world flag (see SYD-004).

### A. Moving, driving, vehicles
- [ ] ENGINE First-person-by-default camera + V toggle to third-person orbit, camera pull-in when a building is between (`camera.js`, `fpsview.js`)
- [ ] ENGINE On-foot: walk, sprint (stamina), high jump, crouch / prone (C, C C) with stealth effect (`input.js`, `main.js`)
- [ ] ENGINE Arcade driving model, handbrake, crash damage thresholds, fire/explosion, dents (`vehicles.js`, `main.js`)
- [ ] ENGINE Car-jacking: walk to the door, haul the driver out, timid drivers flee, brave ones fight (`hijack.js`)
- [ ] ENGINE Bikes: motorbike, scooter, push bike (pedal mechanic), lean (`bikes.js`) — pooled in traffic
- [ ] ENGINE Hover vehicle (DeLorean) easter egg — keep or drop, owner's call
- [ ] ENGINE Per-car paint colour from weighted real-world families (`carPaint.js`) — and apply per instance, not per model (Bayou W5)
- [ ] ENGINE Vehicle radio on R in a car, K mute, stations (`radio.js`, `music.js`) — **NEW FOR SYDNEY** a Sydney playlist
- [ ] **NEW FOR SYDNEY** Drive on the **LEFT**. Check `buildLanes.js` pairs and the spawn side; traffic, overtaking, junction right-of-way, and the cross-the-road NPC logic all follow from it. Verify before anything else in this section
- [ ] NEW FOR SYDNEY Vehicle set: Australian-looking cars (Holden/Ford-style utes, sedans, taxis, buses, trams — see C), no US pickups/school buses; hue-shift variants
- [ ] ENGINE Freeways/tunnels/overpasses, multi-lane roads (`freeway.js`, `roads.js`) — Sydney has the Harbour Bridge/Tunnel, M1, Cahill Expressway: map the real ones
- [ ] ENGINE Potholes / road wear, road markings, crosswalks, traffic lights (`potholes.js`, `markings.js`) — metric signage, km/h

### B. Combat, weapons, damage
- [ ] ENGINE Weapon slots 1-5 + wheel cycling: bat, pistol, Tec-9, sawn-off, rifle; ammo + reload; ADS (right click); recoil (`weapons.js`, `weapons_3d.js`)
- [ ] ENGINE Weapons are hand-parented and aim-solved; first-person view model (`weapons_3d.js`, `fpsview.js`)
- [ ] ENGINE Line of fire / cover: shots stop at walls, NPCs will not shoot through them (`lineOfFire.js`)
- [ ] ENGINE Gore: blood spray/pools, dismemberment-level hit feedback (`gore.js`) — keep rating gate
- [ ] ENGINE Melee: bat swings, punches, finishing
- [ ] RESKIN Gun shops/counters: Australia is tightly regulated; keep the mechanic as a **black-market dealer** rather than a shopfront
- [ ] ENGINE Gunshot audio, tracer, muzzle flash, shell effects (`gunAudio.js`, `fx.js`)

### C. World, places, movement through the city
- [ ] ENGINE Day/night cycle, world clock, sky, sun, street lights, light pool (`daycycle.js`, `worldtime.js`, `graphics.js`)
- [ ] ENGINE Weather system: rain, fog, storm (`weather.js`, `rain.js`) — RESKIN Sydney weather: heatwave, bushfire haze, the Southerly Buster, east-coast-low storms. **No hurricanes** (Louisiana)
- [ ] ENGINE Minimap/radar (rotates with camera, zoom with speed, blips) and the full pause-menu map with waypoints (`minimap.js`, `pauseMenu.js`) — Sydney map bounds
- [ ] ENGINE Terrain hills (`terrain.js`) — Sydney is currently deliberately flat; the Blue Mountains, harbour cliffs and the CBD ridge are the real hills
- [ ] ENGINE Interiors kit: enterable shops, bars, casinos, hospitals, safehouses (`interiors.js`, `casinos.js`, `safehouses.js`, `services.js`)
- [ ] ENGINE Districts system: one origin per place, "moving a town is two numbers" (`districts.js`, `composer.js`, `townkit.js`) — Sydney already has 19 real district names
- [ ] NEW FOR SYDNEY Public transport (**trams are being added to Bayou, W3**): Sydney has the light rail (L1/L2/L3), the Sydney Trains network, ferries on the harbour and the Manly ferry. Streetcar tech is shared; Sydney gets its own routes and liveries
- [ ] ENGINE Day/night shop hours, night-only world mode (Bayou TASK-090) — verify before enabling
- [ ] ENGINE Draw-call discipline: `mergeRigid`, `batchStatic` in 48 m chunks, cull groups per district, F3 perf overlay (`merge.js`, `debug.js`)

### D. People, crowds, NPC behaviour
- [ ] ENGINE NPC brain: idle/wander/loiter on home turf, flee on gunfire, fight/flee by temperament, staggered think timers, far-NPC freeze (`npc.js`)
- [ ] ENGINE Spawn by zone/district (`spawnzones.js`), density tuning near the spawn, venue-aware spawning (never inside venues)
- [ ] ENGINE Crowds and street life: loiterers, queues, buskers, vendors (`crowd.js`, `streetlife.js`)
- [ ] ENGINE Talk to anyone (E): branching dialogue, number-key choices (`dialogue.js`) — RESKIN all lines into Australian English
- [ ] ENGINE Pedestrian barks/chatter at the player (`pedestrianChatter.js`) — RESKIN slang
- [ ] ENGINE Faction reputation: kill 3 of a gang and the other one likes you (`factions.js`) — RESKIN the two factions (replace hoodrats/rednecks with Sydney-appropriate crews)
- [ ] ENGINE Hostile gangs that actually fight (`MAX_HOSTILE` pile-on cap), brave/timid temperament
- [ ] ENGINE Loot drops from NPCs: cash, weapons, ammo (`loot.js`) — currency becomes **AUD**
- [ ] ENGINE Street-level crime economy (dealers, buffs, addiction consequences — Bayou TASK-089, module-only so far)
- [ ] ENGINE Bumping into pedestrians: a shove and a one-liner
- [ ] ENGINE Skin/character variety: procedural rig, palette-driven (`characters.js`, `playerCharacters.js`) — Sydney needs a more varied cast (the city is ~40% born overseas)

### E. Law, wanted, crime
- [ ] RESKIN Wanted/heat system: witnessed crime raises heat, thresholds 1-6 stars, search/evasion, give-up window (`police.js`) — SYD-004 says no US police: replace the sheriff set with **NSW Police** (blue/white check, Highway Patrol, paddy-wagon, Police Rescue) and keep the module
- [ ] ENGINE Foot cops, cruisers, helicopters, roadblocks; cops who *visibly hold and aim a gun* (Bayou W7)
- [ ] ENGINE Crime exemptions (zombie/hog kills are not crimes), police stand down at wanted 0
- [ ] ENGINE Arrest / busted / respawn flow, hospital bill, weapon loss (open in both repos; "Respawn" under CARRIED OVER)
- [ ] ENGINE Pay 'n' Spray equivalent: respray to shake the heat (`services.js`)

### F. Progression, RPG layer, UI
- [ ] ENGINE S.P.E.C.I.A.L., skills, traits, backgrounds, perks, levelling (`stats.js`, `pipboy.js`) — the Pip-Boy green-phosphor menu stays (Fallout reference, not US-only)
- [ ] ENGINE Save/load: 3 localStorage slots (`savegame.js`), story-mode resume points (open in both)
- [ ] ENGINE Pause menu, options tab (quality tiers, resolution), tips that appear when relevant (`pauseMenu.js`, `tips.js`)
- [ ] ENGINE Difficulty scaling (`difficulty.js`), stats tracking, ledger/evidence board UI (`ledgerboard.js`) — only if Sydney gets a story
- [ ] ENGINE Input rebinding single source of truth (`input.js`)
- [ ] ENGINE HUD: health/stamina bars, objective line, wanted stars, compass, F3/F4 debug

### G. Zombie / survival mode
- [ ] ENGINE Zombie Mode on top of Free Roam: night-only horde, archetypes as data, screamer calling the horde, scent/noise/stealth, safehouses, difficulty curve (`zombies.js`, `npc.js`, `outbreak.js`, `difficulty.js`)
- [ ] ENGINE Zombies hunt NPCs too (Bayou W7 is verifying this live); bitten NPCs turning
- [ ] NEW FOR SYDNEY Safehouse sites and the "never inside venues" exclusion mapped to Sydney venues (Opera House, Star casino, Central Station, hospitals)
- [ ] NEW FOR SYDNEY Horde set pieces at real landmarks (Harbour Bridge crossing, Bondi, Circular Quay)

### H. Audio, atmosphere, presentation
- [ ] ENGINE Audio engine: spatial voice (HRTF panner, distance rolloff, wall occlusion), car engines, gunshots, ambience (`audio.js`) — **adopt the Bayou W9 fixes** (master bus, shared reverb, ducking, loudness-normalised voices) rather than porting the old graph
- [ ] RESKIN Voice cast: SYD-004 says the American Fish Audio voices go; needs an Australian voice set or subtitles only (`voiceCast.js`, `tools/voiceover-gen.mjs`)
- [ ] ENGINE Graphics pipeline: PBR, IBL, ACES, soft shadows, fog, light shafts, wet roads, quality tiers (`graphics.js`, `fx.js`)
- [ ] ENGINE Neon signage, canvas signs that fit their text (`neonsign.js`) — Sydney signs (Coca-Cola Kings Cross sign, Luna Park face, Sydney Tower)
- [ ] ENGINE Cinematic cutscene timeline (`cinema.js`) — only for Sydney missions

### I. Story, missions, activities (generic mechanics only)
- [ ] ENGINE Mission framework: objectives, waypoints pinned to the radar rim, triggers, cutscene hooks (`prologue.js`, `actone.js`, `theCount.js`, `syncCampaign.js`, `greedoCampaign.js`) — Sydney needs its own story; do not port Keseme/Louisiana plots
- [ ] ENGINE Side activities: casinos (slots, tables), bars/clubs with music beat and a venue "bubble", fishing, gas cans/fuel, pickups
- [ ] ENGINE Multiplayer foundation: rooms, snapshots, shared zombie mode (`multiplayer.js`, `server/`) — Sydney reuses the Worker/Durable Object
- [ ] ENGINE Map editor dev tool + R2 asset library (`mapEditor.js`) — directly useful for SYD-003 (placing real asset models)

### J. Things Bayou is about to gain (coordinate so Sydney does not fork) — Bayou TODO W1-W10, 2026-10-07
- [ ] **No invisible walls** rules (passability taxonomy: solid / vaultable / soft / gap; collision must match mesh). Sydney SYD-001 (circumscribed circles, 2.7x overshoot) is the same disease: **share one fix**
- [ ] Skyline height field + urban-zone module (Sydney CBD must keep tower height consistent; same `towerHeightFloor` idea)
- [ ] Trams/light rail tech (`src/transit.js`) — Sydney routes
- [ ] Per-instance car colour variants, real car models instead of box cars (Sydney's traffic uses the Bayou box limo/parked cars today)
- [ ] Weapon first-person + audio overhaul; cops holding guns; zombies attacking NPCs
- [ ] NPC visual quality pass
- [ ] Bus graph / reverb / loudness-normalised voices

### K. Deliberately NOT ported (USA/America-exclusive or already ruled out)
- US-167, Louisiana parishes, the 50-state map frame, Mississippi River, Port Calypso/Oyster Bay/Red Dust/Chatboro/Tusouxroe/Shruston/Charsoufre and the whole OrleaRouge/French Quarter/Crown Strip content
- Sheriff / parish police, `Happy Hogs`, `Billy Jeans`, `Popeyes`, `6twelve`, `BurgerPiz`, `Pay 'n' Spray` branding and the US store brands (SYD-004)
- Klan, redneck/hoodrat caricature factions as written, Huey Newton ghost, voodoo/cemetery "city of the dead", Mardi Gras and Southern-gothic prologue/plot
- Feral hogs (SYD-004), hurricanes, US dollar, miles/mph signage, US road-sign set, US licence plates
- **Adult-club branches / dance mini-game** (Bayou TASK-088): the Sydney design note already says this has no place in a Sydney build
- Fish Audio American voice set

### How to work it
1. Start with the **driving-side check** (A) and SYD-001/002 — nothing else can be judged in a world you cannot walk or drive.
2. Add `SYDNEY_MODE` (SYD-004) and give every ENGINE row an explicit on/off for Sydney, so "ported" is a testable flag and not a feeling.
3. For each row: turn it on, run it in a browser (Edge headless works on this machine: `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`, `--use-gl=swiftshader`), record what actually happened here. Rows stay `[ ]` until observed working.
4. Rows marked "Bayou W-number" are being designed in the Bayou repo now; take the result rather than duplicating it. Re-read the Bayou TODO before starting any of them.

---

## 🟡 CARRIED OVER — needs re-verification

From the human-request backlog in the archived board. Listed because the request was
never formally closed, not because the work is confirmed outstanding.

- [ ] **Road clearance** — nothing may stand in a carriageway. Plan was a
      `tools/qa/road_clearance.mjs` mesh/blocker census within ~4 m of every lane.
      Believed relevant to Sydney: real OSM geometry was never checked against the
      tarmac it sits on. Overlaps TASK-SYD-001 and is folded into it.
- [ ] **Enter Popeyes / Happy Hogs / Billy Jeans branches, hospitals** — branch shells
      existed; interiors and orchestrator wiring unfinished.
- [ ] **Character models** — still procedural primitives. Research in
      [`docs/CHARACTER_CRAFT.md`](docs/CHARACTER_CRAFT.md). Needs real CC0 GLB
      characters + skeletal animation, or a much richer procedural pass.
- [ ] **Story-mode save/load** — free roam and zombie mode have 3 localStorage slots;
      scripted chapters have no resume points.
- [ ] **Respawn** — no hospital bill, no weapon loss, sheriffs stand down at wanted = 0.
- [ ] **Vehicle lane usage** — the archived board ends with
      *"cars are not using the lanes — NOT YET DIAGNOSED"*. Never diagnosed.
- [ ] **Terrain** — stage 1 (hills) landed and is tested. Still open: slope limits,
      valleys below the ground plane, height handling for loot, gore, billboards and
      the minimap. Sydney is deliberately flat and documented as such.
- [ ] **Weather** — landed and tested. Still open: not networked in multiplayer, no
      wind sway, no hurricane world effects. (Both are Louisiana weather.)
- [ ] **Not verified on a real GPU** — the Options tab at other resolutions, and the
      general look of the newest outfits.

## ⛔ Design note — do not implement until asked

- [ ] Non-graphic mature-content interaction for adult NPCs: consensual, age-gated,
      non-explicit (stylised rhythm activity or fade-to-black). **No graphic sexual acts.**
      Every character stays fictional and 25+. The game is R18+; the launch
      acknowledgement is the only gate. The dancer presentation is already done —
      see the archived board's 2026-09-30 entry. Note this is Louisiana content;
      it has no place in a Sydney build.

---

## ✅ Recently landed

- **Sydney is playable in the main game** behind `?sydney=1`: 149.5 km of real OSM
  road centrelines, 2907 traffic lanes wired across junctions, 27.9 km drivable,
  spawn on George Street in the CBD, ~2 draw calls, 141 ms build, zero runtime
  network traffic. Details in [`sydney-osm-world/docs/GAME-INTEGRATION.md`](sydney-osm-world/docs/GAME-INTEGRATION.md).
- **Sydney content** — harbour, 15 parks, 972 real footprints, 19 real district
  names, 76 landmarks, as four draw calls (`src/sydney/content.js`). **This is the
  layer 001 and 002 are about.**
- Terrain stage 1, weather, freeways, multi-lane roads, save/load, Pip-Boy, the
  Crown Strip, the Sydney road network — see the archived board for the full record.

---

## 📝 Update rule

Whenever an agent changes the state of a task, record at minimum:

```
Task ID · Status · Agent · Files affected · Dependencies
What changed · What remains · Testing performed · Known issues
```

**Do not claim work is complete merely because code was written.** A task becomes
`COMPLETE` only after it has been tested and reviewed. Record what was actually
tested; never report a test you did not run.
- [ ] DECISION: SYD-003 look — voxel set chosen (coherent) [P2] [design] — checkpoint 37aaade
