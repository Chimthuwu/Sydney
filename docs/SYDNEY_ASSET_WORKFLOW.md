# Sydney asset workflow

How Sydney stops being 972 extruded prisms and becomes a city built out of real
models, the way Louisiana is built out of `assets/models/`.

**Status:** plan, not started. Written 2026-09-30 for a working session.
**Task:** [`TODO.md`](../TODO.md) → TASK-SYD-003.

---

## 1. The library

`Z:\GITHUB\_ASSETS` — the folder is `_ASSETS`, with a leading underscore.
`Z:\GITHUB\_ASSETS\INDEX.md` is its own index; these are the entries that matter here.

### Buildings

| pack | format | size | contents |
|---|---|---|---|
| `3D/Buildings-Voxel/Small Building 01–04.zip` | OBJ/MTL/PNG | ~1.1 MiB ea | `SmallBuilding01`–`04` |
| `3D/Buildings-Voxel/Tiny Building.zip` | OBJ/MTL/PNG | 1.3 MiB | `TinyBuilding01` |
| `3D/Buildings-Voxel/Large Building 01.zip` | OBJ/MTL/PNG | 1.6 MiB | `LargeBuilding01` |
| `3D/Buildings-Voxel/Tall Building 01–03.zip` | OBJ/MTL/PNG | ~1.3 MiB ea | `TallBuilding01`–`03` |
| `3D/Buildings-Voxel/VoxelShopBuildings.zip` | OBJ/MTL/PNG | 507 KiB | `ShopBuilding_1`, `ShopBuilding_2`, `PhoneCabin`, a parked `Car`, a `GroundTile` |
| `3D/Buildings-Shops/Downtown City MegaKit[Standard].zip` | FBX | 224 MiB | large modular downtown kit — brick pieces, columns, trim. **Not in the repo yet** |
| `3D/Buildings-Shops/Buildings.rar` | DAE/FBX/GLB | 20 MiB | generic buildings + brick textures |
| `3D/Buildings-Shops/TownTileSet.zip` | FBX/GLB/Blender | 3.5 MiB | textured town tile, day/night textures |

The voxel set is one coherent low-poly faceted style across all nine models — they
were designed to sit together, so they will not look like a ransom note.

### Street furniture and roads

| pack | format | size | contents |
|---|---|---|---|
| `3D/Buildings-Shops/free city pack.zip` | FBX | 734 KiB | benches, road pieces, signs, hydrant, car, traffic light |
| `3D/Roads-Infrastructure/[FREE] Modular Roads - Base.zip` | FBX/glTF/OBJ | 20 MiB | road pieces, splitters, barrels, cones |
| `3D/Roads-Infrastructure/Urban_Modular_Demo.zip` | glTF | 2.1 MiB | pavement and pillar pieces |

The Louisiana-specific kits (`6twelve`, `Gas_station`, `Tacos`, `BurgerPiz`,
`Pizzeria`, `Quequis_House`, `Trailer_Park`, `Bus_stop`, `Sewer`) are American
storefronts and are **not** candidates for Sydney. `Sewer.rar` is the exception —
Sydney has the same storm-drain escape the Louisiana story uses.

---

## 2. What is already in the repo

**Most of this is already extracted and sitting unused.** Checked 2026-09-30:

| `assets/models/` | holds | status |
|---|---|---|
| `voxel_buildings/` | all **nine** voxel buildings, as `.obj` + `.mtl` + `.png` | **extracted, not referenced by any `src/` file** |
| `buildings/Buildings.glb` | the `Buildings.rar` pack | in use by Louisiana |
| `urban/` | `Pavement`, `Pillar`, `Road`, `Roof`, `Stair`, `Streetlamp`, `Wall`, `Window` — the Urban Modular pack | in use by Louisiana |
| `office/`, `shops/`, `town/`, `gasstation/`, `sixtwelve/`, `tacos/`, `burgerpiz/`, `trailerpark/`, `shacks/` | the Louisiana shop kits | in use; American, not for Sydney |

`grep -rn "voxel_buildings" src/` returns nothing. The nine models are complete,
loadable, and unused.

**So the session is mostly placement code, not asset wrangling.** The only pack
that has to be pulled across is the MegaKit, and that is a decision, not a chore.

---

## 3. Order of operations

This matters, because it decides what work is worth doing.

| | Task | Still needed if we go the asset route? |
|---|---|---|
| 001 | collision circles too big → invisible walls | **Yes, unchanged and urgent.** Independent of how the mass is drawn. Do it first — it is what makes the game unplayable today. |
| 002 | half the prisms render inside-out | **Largely mooted.** If the prism mesh is deleted, the winding bug goes with it. The water/parks half of 002 is *not* mooted and still needs doing. |
| 003 | build from real assets | The session's main event |

**Recommended order:** 001 → extract/inspect the MegaKit → 003 → the water/parks
half of 002. Fixing the prism winding in 002 before 003 is likely wasted effort.

---

## 4. The workflow

### Phase 0 — unblock playability
Fix 001. Assert every lane in `buildLanes.js` is drivable end to end with nothing
blocking it. Until this lands, nothing else in Sydney can be judged by driving it.

### Phase 1 — look at the assets
Do not write placement code first.

1. Pull `Downtown City MegaKit[Standard].zip` across to `assets/models/megakit/`.
2. Open the nine voxel models in `tools/characters.html`-style viewer, or just
   render them next to the current prisms and take a screenshot.
3. **Decide the look.** The voxel set is stylised and faceted; the MegaKit is
   modular and detailed; the prisms are currently flat grey in a photoreal HDR
   pipeline (`graphics.js` derives PBR maps, does GTAO/bloom/SMAA/filmic grade).
   Mixing a stylised voxel house next to a detailed brick tower in a graded HDR
   frame may look worse than either alone. Pick one, commit to it.
4. Note the real dimensions of each model — the placement code needs them, and the
   pack listings do not give them.

### Phase 2 — the mapping
972 real footprints onto ~9 models (plus whatever the MegaKit yields). This is the
actual design problem and the thing worth getting right.

Inputs per building, all already in `src/sydney/cityData.js`:
- `fp` — the footprint ring, in metres, game convention (north = −Z, east = +X)
- `h` — height, from OSM `levels`/`height` where present, else derived
- `name` — for logging and for picking named landmarks by hand

Proposed, in order:

1. **Bucket by height**, so the skyline keeps its shape and the CBD still reads as
   a canyon rather than a uniform field:
   - `< 8 m` → `Tiny_Building`, `Small_Building_01`
   - `8–20 m` → `Small_Building_02`–`04`, `ShopBuilding_1/2`
   - `20–50 m` → `Large_Building_01`
   - `> 50 m` → `Tall_Building_01`–`03`
2. **Within a bucket, pick by footprint area** so a big footprint gets a big model
   and a 13 m² shed does not get a tower.
3. **Fit, do not stretch.** A uniform scale + rotation + translation matched to the
   footprint's principal axis. Non-uniform scaling would distort windows and doors
   and read as obviously wrong up close.
4. **Seed it.** Derive the pick from a hash of the building's id or name, not from
   iteration order, so the city is identical on every reload and every machine.
5. **Keep the OSM footprint as the source of truth** for position, height and
   collision — the model is the skin, the footprint is the fact.

### Phase 3 — placement and baking
- New module, e.g. `src/sydney/placeBuildings.js`, called from
  `src/sydney/content.js` where `buildingGeometry()` is now. Keep `content.js` the
  owner of the city layers; do not put this in `main.js`.
- Every placed model goes through the `graphics.js` derived-PBR pass like everything
  else, so materials classify the same way.
- **Batch them.** `merge.js` already has `batchStatic` (merges per material in 48 m
  chunks) and `mergeRigid`. The voxel models share one texture, so they should
  collapse back into a handful of draw calls. The current one-mesh city costs ~2
  draw calls and there is a ~4.5k budget the rest of the world already spends —
  re-check this before it becomes a problem.
- Keep the city at 4 draw calls if at all possible: water, parks, buildings, labels.

### Phase 4 — collision
Reuse the 001 fix. The footprint rings are unchanged, so the better collider from 001
applies to the placed models with no extra work. This is a good reason to do 001
first and reuse it rather than solving it twice.

### Phase 5 — QA gates
New `tools/qa/sydney_content_test.mjs`, added to `npm test`:
- [ ] every footprint got a model, none silently dropped
- [ ] the mapping is deterministic — same city on two runs
- [ ] height buckets land in the right models (CBD still has tall things in it)
- [ ] no model intersects the tarmac or a traffic lane
- [ ] draw calls within budget
- [ ] blocked area back within ~1.2× of real footprint area (the 001 assertion)
- [ ] Louisiana mode unchanged

Then drive it. A screenshot from street level in the CBD, and one from the air, and
actually drive George Street end to end.

---

## 5. Open questions to settle in the session

- [ ] Voxel set, MegaKit, or a mix? See Phase 1 — this blocks everything else.
- [ ] What happens to the prisms: deleted, or kept as a low-detail proxy?
- [ ] Do the MegaKit's modular pieces get assembled per building, or used as-is?
- [ ] Street furniture (`free city pack`) — in scope for this session or its own task?
- [ ] The 12.8 m of the model scale — confirm units, and whether any pack is in cm.

## 6. Licensing

This is a personal project for fun, so pack licences are not a gate on the work.
If it is ever published or distributed, revisit the per-pack terms then — several
of these are third-party downloads and `INDEX.md` says as much. Not a blocker now.
