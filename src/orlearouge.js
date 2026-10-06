// ---------------------------------------------------------------------------
// orlearouge.js — the south of the map: the bayou causeway and OrleaRouge.
//
// "A metropolis of French balconies, glass skyscrapers, neon nightlife,
//  historic neighborhoods, universities, casinos, music halls and sprawling
//  suburbs. It is simultaneously gorgeous and wounded."
//
//   z 130 … 196   the southern approach, INSIDE the city: US-167 comes in over
//                 the downtown viaduct and lands on the boulevard, and the
//                 towers of the CBD rise on both sides of it. This used to be
//                 open swamp with a camp under an overpass and a refinery
//                 burning on the horizon — which read, from the causeway, as
//                 the emptiest possible approach to the largest city in the
//                 state. It is now the busiest part of it.
//   z 196 … 500   OrleaRouge, on a street grid around the boulevard (US-167):
//                 the French District (west), downtown towers (east), the public
//                 hospital, a cemetery, a construction site, and the waterfront
//                 with a casino boat moored on the Gulf
//
// Everything is static except the neon flicker, so main.js's batchStatic
// merges the city per material and chunk. Buildings share materials; their
// UVs are scaled to their size, so one window texture tiles correctly on every
// tower without per-building materials.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { placeOfficeClutter, placeCityBuilding, placeParkedCar } from "./landmarks.js";
import { createCemetery } from "./cemetery.js";
import { createCityParts } from "./cityparts.js";
import { createNewOrleansLandmarks } from "./nolalandmarks.js";
import { createStreetLife } from "./streetlife.js";
import { makeRoadway } from "./traffic.js";
import { createOrleaFringe } from "./orleafeinge.js";

/** A deterministic 0..1 hash, for choosing what goes on a block. */
const hashf = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

export const CAUSEWAY = { minZ: 136, maxZ: 192 };

/**
 * The SEAM: the 64 m of ground between Downtown Bayou's south edge (z 128) and
 * this city's north edge (z 196), west of the causeway.
 *
 * It is the last hole in the middle of the map and it was never a district —
 * it was a gap between two of them, 142 m by 64 m of grey ground that the player
 * can stand on, drive across, and see from both cities. Its cause is a
 * coordinate, not a design decision: `westparish.js` suppresses its own forest
 * inside a hard rectangle ending at z = 128, because that is where Metro's grid
 * stopped, and the city's grid starts at z = 196 because the causeway and the
 * swamp do. Nothing in between was ever anyone's.
 *
 * What belongs there is not more city. It is the working edge both of them grew
 * out of: the river frontage — a canal, a rail spur, warehouses with loading
 * docks, chain-link, a fuel tank — low and wide and fenced, which is what is
 * actually between a downtown and a suburb.
 */
export const SEAM = { x0: -292, x1: -156, z0: 132, z1: 196 };

// The nightlife core now continues east into a denser modern district. Keep the
// western boundary stable (the parish transition and French District depend on
// it), but give the skyline and casino lots room to grow on the east side.
//
// SCALE. "The city area needs to feel like a bustling metropolis eventually… we
// can really push the overall scale of the map much MUCH more." It was 656 x 186
// m — about twelve blocks by four, which is a large town. It is now 816 x 304,
// twice the area, and the growth is all to the east and south, which is the
// direction a city's downtown actually grows: the French Quarter and the parish
// are fixed by the geography, and the CBD is not.
// The west edge stands 6 m off the first avenue, which is the same standoff the
// east edge keeps off the last one (680 against 674). Sharing the coordinate
// with the avenue instead would put a duplicate in `blocks()`'s xs list and a
// zero-width column in front of it.
export const CITY = { minX: -292, maxX: 680, minZ: 130, maxZ: 500 };

/**
 * The floodwall and the rail spur on the city's west edge, exported because
 * `westparish.js` has to keep its forest off them and cannot import the
 * districts list to ask (metro.js imports westparish.js, so that closes a loop
 * and every module in it dies on "Cannot access 'METRO_BOUNDS' before
 * initialization"). A named constant that lives with the thing that owns it is
 * not the same failure as a hand-typed copy of somebody else's rect.
 */
export const LEVEE = { x: CITY.minX - 20, railX: CITY.minX - 32 };

/**
 * OrleaRouge is the biggest city in the state and the only one that never said
 * so. Every other place announces a population — Shruston 231,400, Charsoufre
 * 81,210, Tusouxroe 48,200 — and this one announced none, so the largest number
 * on the map belonged to a district that is a third of its size.
 *
 * 611,470 is New Orleans (383,997) plus Baton Rouge (227,470), which is what
 * the name is: the two of them, one city.
 */
export const POPULATION = 611470;
const POP_TEXT = "pop. 611,470";

// the grid: US-167 is the boulevard at x = ROAD_X (-6)
//
// Avenues sit 40 m either side of the boulevard and every 40 m after that, which
// is the pitch the old west end already used — so this is a grid EXTENDED, not a
// new one, and all fourteen existing avenues are still in the same place. That
// matters because main.js places the Pay 'n' Spray, Frenchmen Street, the
// casinos and the Crown Strip by coordinate.
//
// THE WEST END IS NOW THE RIVER. It used to be five avenues short of one: the
// grid stopped at x -136 and everything from there to the parish was 9.7 ha of
// nothing at the same latitude as downtown, which is what the aerial with the
// empty ground outlined was looking at (human report, 2026-09-28). A city that
// simply stops is a wall of buildings and then a field, and the field is what
// reads. So the grid now runs five columns further west into the West Bank, and
// the six western avenues are on the same 40 m pitch as the rest.
//
// Everything to the EAST of the new columns keeps its coordinate, which is the
// only thing that has to stay true: main.js places half a dozen set pieces by
// number.
const AVENUES = [-286, -246, -206, -166, -126, -86, -46, 34, 74, 114, 154, 194, 234, 274, 314, 354, 394, 434, 474, 514, 554, 594, 634, 674];
// The southern approach is inside the grid now, so it gets street lines on the
// same 40 m pitch as the rest: 170 and 130 bracket the band that used to be
// swamp. They are at the PITCH, not at hand-picked round numbers, because a
// grid with one irregular spacing in it is the thing that makes a city look
// surveyed rather than laid out. 130 is CITY.minZ, so the first row is the
// 40 m between them.
const STREETS = [130, 170, 210, 250, 290, 330, 370, 410, 450];        // east–west streets
const STREET_W = 9;

/**
 * Superblocks: ground where the grid is taken out entirely.
 *
 * A 40 m pitch gives 26 m plots, and the set pieces do not fit in a 26 m plot.
 * The Superdome is 244 m across. City Park is 155 acres. A cathedral with
 * three steeples needs its nave and its square. So these rects suppress BOTH
 * the blocks and the streets inside them — suppressing only the blocks would
 * leave an avenue running straight through the middle of a stadium, which is
 * worse than not having the stadium.
 *
 * They are how a real city is actually laid out, too: the grid breaks around
 * the Superdome's footprint and the park exactly the way it does in the one
 * everybody knows.
 */
export const RESERVES = Object.freeze([
  { x0: 420, x1: 680, z0: 200, z1: 460, label: "The Superdome" },
  { x0: 236, x1: 410, z0: 384, z1: 500, label: "City Park" },
  { x0: 100, x1: 230, z0: 384, z1: 470, label: "Loyola University" },
  { x0: -136, x1: -34, z0: 396, z1: 500, label: "Jackson Square" },
  { x0: -136, x1: -58, z0: 214, z1: 282, label: "French Market" },
]);

/**
 * Where the grid's streets and avenues are cut: the superblocks, and the seam.
 * The seam is not a superblock (it is not a block at all, so it stays out of
 * RESERVES and out of blocks()' superblock emission) but it has its own road
 * network, and the z 130 / 170 streets and four West Bank avenues were paved
 * straight across it, over the canal railing and through the warehouse row.
 * Its north edge is taken out to CITY.minZ - STREET_W so no avenue leaves a
 * 2 m stub of tarmac between the street that is no longer there and the canal.
 */
//
// And the viaduct (buildCauseway): the ground under its deck was laid out as a
// plaza — planters and benches where the camp was, two rows of piers, and the
// causeway's guardrails closing the boulevard — before the z 170 street was
// added straight through it. The street stops either side; the avenues still
// pass under, so this one cuts streets only.
const STREET_CUTS = Object.freeze([
  ...RESERVES,
  { x0: SEAM.x0, x1: SEAM.x1, z0: CITY.minZ - STREET_W, z1: SEAM.z1, label: "the river edge" },
  { x0: -76, x1: 76, z0: 167.5, z1: 176.5, label: "under the viaduct", streetsOnly: true },
]);

/** True if (x, z) is inside a superblock, `pad` metres out from its edge. */
const inReserve = (x, z, pad = 0) => RESERVES.some((r) =>
  x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);

// Where the city's parts change character, west to east. This is a real
// sequence and it is the reason the place reads as a city rather than a grid
// with towers in it: the Quarter is low and tight, the CBD is tall, and the
// civic end further out is where the big set pieces go, because that is where
// the land is flat and the blocks are big enough to hold them.
export const ZONES = Object.freeze({
  boulevard: -6,        // US-167; west of it is the Quarter
  westbank: -166,       // …and west of THAT is the West Bank: low, mixed, working
  garden: 330,          // …and south of this, west of the boulevard, is the Garden District
  cbd: 260,             // east of the boulevard to here is downtown: the towers
  midtown: 470,         // …to here is the brick fabric between downtown and the edge
  civic: 470,           // east of here is the civic end, where the set pieces go
  edge: 410,            // north of this is the low-rise edge, citywide
});

/**
 * Which part of the city a block belongs to. One function, one answer, rather
 * than four overlapping position tests in four builders — the old arrangement
 * meant a block could satisfy "downtown" and "outskirts" at once, and which one
 * got it depended on the order the builders happened to run in.
 *
 * The order of the tests is the order of the city as you drive into it from the
 * west: the Quarter, then the Garden District, then downtown, then midtown,
 * then the civic end — with the low-rise northern edge taking precedence
 * everywhere, because a city's edge is low-rise on every side at once.
 *
 * There is no "outskirts" zone. There was one, and after the grid grew it could
 * never fire: the civic end begins at the same x the outskirts used to end, so
 * every block past it was civic and the old fringe builder was dead code that
 * still read as if the city had a run-down district in it. The low-rise northern
 * edge is what `edge` is for.
 *
 * `ctx.ROAD_X` is read at call time, not baked in, so the grid follows the
 * boulevard if it is ever moved.
 */
function zoneOf(b, roadX) {
  if (b.cx < ZONES.westbank) return "westbank";
  if (b.cx < roadX) return b.cz >= ZONES.garden ? "garden" : "quarter";
  if (b.cz >= ZONES.edge) return "edge";
  if (b.cx >= ZONES.civic) return "civic";
  if (b.cx < ZONES.cbd) return "cbd";
  return "midtown";
}

function basic(color) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.userData.gtbRealized = true;
  return m;
}
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/**
 * A tiling water-surface normal map: long, low swells with finer chop across
 * them. Written as a real normal map (RGB = XYZ) rather than a grey bump,
 * because the water material is physical and its clearcoat needs a believable
 * surface to reflect the sky and the neon off.
 *
 * `stretch` is how many times longer a swell is than it is wide. Above 1 the
 * crests lie along u — along the shore, for the gulf plane — which is the
 * orientation both a current and a shoreward swell want; only the axis they
 * scroll on differs.
 */
function waterNormalTex(size = 256, stretch = 5) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  // a small sum of sines makes a seamless, tileable height field: every term
  // uses an integer number of periods across the texture, so the edges match
  // Wavenumbers MUST be whole numbers of periods across the texture or it does
  // not tile — a fractional kx leaves a seam every repeat, which at this scale
  // is a visible line straight across the water every tile.
  //
  // Long wavelength along the flow (small kx) and short across it (kz = kx *
  // stretch) is what gives swells that lie down the current instead of a
  // uniform ripple.
  const waves = [];
  for (let i = 0; i < 5; i++) {
    const kx = 1 + i;
    waves.push({
      kx,                                    // few periods along the flow: long swells
      kz: Math.max(1, Math.round(kx * stretch)),   // many across it: chop
      amp: 1 / (1 + i * 1.3),
      phase: i * 1.7,                        // break up the harmonic regularity
    });
  }
  const height = (u, v) => {
    let h = 0;
    for (const w of waves) {
      h += w.amp * Math.sin((u * w.kx + v * w.kz) * Math.PI * 2 + w.phase);
    }
    return h;
  };
  const e = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // central differences give the slope, and the normal is its cross product
      const dx = (height(u + e, v) - height(u - e, v)) / (2 * e);
      const dz = (height(u, v + e) - height(u, v - e)) / (2 * e);
      const sc = 0.012;                      // keep the surface gentle, not choppy
      let nx = -dx * sc, ny = 1, nz = -dz * sc;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 2] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // a normal map is data, not colour — tagging it sRGB would wash the vectors out
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** A box whose side UVs repeat once per `unit` metres, so shared textures tile to size. */
function tiledBox(w, h, d, unitX = 6, unitY = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const side = Math.abs(n.getX(i)) > 0.5 ? d : w;   // faces along x use the depth
    if (Math.abs(n.getY(i)) > 0.5) continue;           // leave roofs / floors alone
    uv.setXY(i, uv.getX(i) * side / unitX, uv.getY(i) * h / unitY);
  }
  return g;
}

/**
 * @param {object} ctx from main.js: scene, surface(kind, size), addBlocker(x, z, r),
 *   addLitSpot(spot), poolLight(color, power, range, x, y, z),
 *   makeBillboard(x, z, ry, headline, sub, graffiti), makeNeonSign(text, ink, bg),
 *   getSheriffProto(), cine, state, playerPos, ROAD_X, ROAD_HALF
 */
export function createOrleaRouge(ctx) {
  const { scene } = ctx;
  const neon = [];          // { mat, base, speed, phase } — flickered in update()
  const currents = [];      // { map, speed, tile } — water surfaces scrolled in update()
  const pois = [];
  const occluders = [];     // overhead boxes the camera must not look through
  // The back-of-block strips this module dresses, for tools/qa/block_interiors_test.
  // The general reach survey cannot see an 8 m alley — its centre is 4 m from a
  // wall on either side, so an undressed alley and a dressed one measure the
  // same — and a gap that no gate can see is a gap with nothing holding it.
  const alleys = [];
  let graveyard = null;     // cemetery.js — holds the ghost, so it has an update and props
  let fringe = null;        // orleafeinge.js — the road out east, and the overpass
  let entered = false;

  // The New Orleans building stock (cityparts.js) — the Creole galleries, the
  // Garden District Italianates, the shotguns, the brick walk-ups. OrleaRouge
  // previously grew its own rowhouses inline and a single glass `tower`; this
  // is the same material vocabulary Metro uses, so the two cities are built
  // from one kit instead of two that drift apart.
  const P = createCityParts(ctx, { occluders });

  // The places you can name: St. Louis Cathedral and Jackson Square, the
  // Superdome, City Park, the French Market, a university. nolalandmarks.js
  // needs this module's mesh/std/basic helpers because it draws into the same
  // scene with the same shared materials, so the whole city batches as one.
  // Commuters and beat cops. ctx.resolveCollision and ctx.isNight are optional
  // so this module can be built in a test without standing up the whole world.
  const streetLife = createStreetLife({
    scene,
    resolveCollision: ctx.resolveCollision || null,
    isNight: ctx.isNight || (() => false),
  });

  const landmarks = createNewOrleansLandmarks(ctx, {    P, mesh, std, basic, pois, occluders,
    sign: (text, w, h, x, y, z, ry, ink, bg) => neonSign(text, ink, bg, w, h, x, y, z, ry),
  });

  /**
   * Every building a block carries is parented to one group, so main.js's
   * batchStatic merges the lot per material and per spatial cell instead of
   * walking several hundred loose meshes. cityparts builds in world
   * coordinates, so the group is left at the origin deliberately — moving it
   * would move the buildings with it.
   */
  const buildingGroup = (b) => {
    const g = new THREE.Group();
    g.userData.gtbBlock = `${b.cx.toFixed(0)},${b.cz.toFixed(0)}`;
    scene.add(g);
    return g;
  };

  // ---------------------------------------------------------------- helpers
  function mesh(geo, mat, x, y, z, { cast = true, parent = scene, ry = 0 } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const matCache = new Map();
  /**
   * `std(name, color, extra)`.
   *
   * cityparts.js spells it `std(color, name, extra)` and nolalandmarks.js is
   * written against THAT one, because it is handed this function and calls it
   * the way its own module does. Every one of those calls therefore arrived here
   * the wrong way round: a number where a name was expected and a string where a
   * colour was. THREE.Color does not throw on "cathedral stucco", it warns and
   * falls back to white — so the Superdome, the cathedral, Jackson Square and
   * the whole French Market were built in undyed white boxes, and the only clue
   * was a stream of "THREE.Color: Unknown color market brick" on stderr that
   * nobody had read.
   *
   * So the swap is repaired where the two conventions meet rather than by
   * rewriting thirty call sites: if the first argument is not a string, the
   * arguments are reversed. Both orders then do what their author meant.
   */
  function std(name, color, extra = {}) {
    if (typeof name !== "string") { const t = name; name = color; color = t; }
    const key = name + ":" + color + JSON.stringify(extra);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ name, color, ...extra }));
    return matCache.get(key);
  }
  function neonSign(text, ink, bg, w, h, x, y, z, ry, flicker = 0) {
    const mat = ctx.makeNeonSign(text, ink, bg);
    mat.userData.gtbRealized = true;
    mat.emissiveIntensity = 1.2;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    mesh(new THREE.BoxGeometry(w, h, 0.25), mat, 0, 0, 0, { parent: g, cast: false });
    scene.add(g);
    if (flicker) neon.push({ mat, base: 1.2, speed: 6 + Math.random() * 10, phase: Math.random() * 9, flicker });
    return g;
  }
  function plane(w, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    // Static, and never touched after build, so opt in to the late static-batching
    // pass in main.js (`runBatch(true)`), which only looks at cullGroup children
    // and roots tagged userData.staticLandmark. Untagged roots are invisible to
    // it, so a plane added straight to the scene stayed a separate draw call for
    // the life of the world -- 1,061 untagged bare meshes were measured in one
    // frustum at spawn. See tools/qa/static_batch_coverage.mjs.
    m.userData.staticLandmark = true;
    scene.add(m);
    return m;
  }

  // ---------------------------------------------------------------- the causeway
  function buildCauseway() {
    const x0 = ctx.ROAD_X - ctx.ROAD_HALF, x1 = ctx.ROAD_X + ctx.ROAD_HALF;
    const len = CAUSEWAY.maxZ - CAUSEWAY.minZ + 8;
    const zc = (CAUSEWAY.minZ + CAUSEWAY.maxZ) / 2;

    // ---------------------------------------------------------------- the fill
    //
    // THERE USED TO BE WATER HERE. Two 300 m planes of "swamp water" at y 0.035
    // either side of the carriageway, and the whole southern approach — the last
    // 70 m before the largest city in the state — was open swamp with a camp
    // under an overpass and a refinery burning on the horizon. Measured, the
    // band was 4.4% covered on its worst stretch.
    //
    // The reason is not that nobody filled it. It is that CITY.minZ was 196:
    // this band was OUTSIDE the city grid, not a hole in it, so no block was
    // ever generated here and nothing could be filled in without rewriting the
    // bounds. The grid now starts at 130 and this is ordinary downtown.
    //
    // So what replaces the water is not a fill operation. It is nothing at all:
    // the ground plane from main.js is already at y 0, the blocks are built on
    // it by downtown(), and this function now builds the road that connects
    // them. The two water planes are deleted rather than covered, because a
    // plane left at y 0.035 under a city is a grey sheet visible in every gap
    // between buildings — the exact failure the gulf comment below warns about
    // when the water was at y -0.25.
    const ground = ctx.surface("asphalt", 512).material(1);
    // the apron the viaduct lands on: a wide, dark, slightly crowned surface so
    // the carriageway does not appear to float over raw ground at the seam
    plane(150, len, ground, 0, 0.024, zc);

    // guardrails the whole way across, solid for walkers and cars
    const rail = std("steel guardrail", 0x9aa0a6, { metalness: 0.8, roughness: 0.4 });
    for (const x of [x0 - 0.6, x1 + 0.6]) {
      mesh(new THREE.BoxGeometry(0.25, 0.7, len), rail, x, 0.6, zc);
      for (let z = CAUSEWAY.minZ; z <= CAUSEWAY.maxZ; z += 3) ctx.addBlocker(x, z, 0.55);
    }

    // The viaduct deck, crossing high above the grid. The piers that carry it
    // are built at the end of this function, once the block underneath has been
    // dealt with.
    const concrete = std("concrete overpass", 0x8f8c86);
    mesh(new THREE.BoxGeometry(150, 1.2, 9), concrete, 0, 8, 172);
    occluders.push({ minX: -75, maxX: 75, minY: 7.4, maxY: 8.6, minZ: 167.5, maxZ: 176.5 });

    // ---------------------------------------------------------------- the piers
    //
    // The camp under the overpass and the refinery on the eastern side are
    // gone, and both were load-bearing in the old design, so it is worth saying
    // why each went rather than just deleting it.
    //
    // THE CAMP (tents, a barrel fire, six tarp cones around x -34, z 170) was
    // here because this was open swamp: the last place in the city where nobody
    // had any claim to be. With the grid now at z 130 this is a downtown block,
    // and a camp on it is not "charming detail" — it is the game's own
    // homeless-and-addiction cast standing in the middle of the financial
    // district, at the exact spot the player arrives at. It goes.
    //
    // THE REFINERY (five tanks and two flare stacks, x 104..132, z 146..186) sat
    // on a concrete pad 4.4 ha into the band, and a pad that size is a whole
    // grid block. It was a landmark read from a distance across water; from a
    // street with towers either side of it, it is an industrial site in the
    // middle of a business district, and the towers the grid now builds there
    // would have grown straight through the flare stacks.
    //
    // What replaces the camp is a planter and a bench — the thing that is
    // actually under a viaduct in a downtown, and which keeps the POI that was
    // on this spot. What replaces the refinery's silhouette is the viaduct
    // deck itself, which is now a real structure with piers rather than a slab
    // floating over a swamp.
    {
      // A planted bed and two benches in the shadow of the deck, at the spot the
      // camp's POI used to be, so the corner still has a destination.
      const kerb = std("planter kerb", 0x8f8b82, { roughness: 0.92 });
      const soil = std("planter soil", 0x4a3f30, { roughness: 0.99 });
      const shrub = std("shrub", 0x4e6b3a, { roughness: 0.95 });
      const bench = std("bench slat", 0x6b5238, { roughness: 0.9 });
      for (const [px, pz] of [[-36, 168], [-22, 176], [-30, 182]]) {
        mesh(new THREE.BoxGeometry(7, 0.7, 3.4), kerb, px, 0.35, pz, { cast: true });
        mesh(new THREE.BoxGeometry(6.2, 0.3, 2.6), soil, px, 0.6, pz, { cast: false });
        for (let i = 0; i < 3; i++) {
          mesh(new THREE.SphereGeometry(0.75 - i * 0.12, 7, 5), shrub, px - 2 + i * 2, 1.05, pz, { cast: true });
        }
        ctx.addBlocker(px, pz, 3.5);
      }
      for (const [px, pz] of [[-29.5, 172], [-25.5, 179]]) {
        mesh(new THREE.BoxGeometry(0.5, 0.45, 2.4), bench, px, 0.45, pz, { cast: true });
        ctx.addBlocker(px, pz, 1.3);
      }
      // one light under the deck, so the space is lit at night and does not read
      // as the hole the camp used to be
      ctx.addLitSpot({ x: -30, y: 4.2, z: 175, warm: 0xffd9a0, power: 70, range: 18, pole: false });
      pois.push({ x: -28, z: 176, r: 7 });
    }

    // The piers themselves. The old deck stood on five columns at x -40..55,
    // which is a pier spacing for a 95 m span, and the deck is 150 m long, so
    // the two ends of it were cantilevered 50 m unsupported — plausible in
    // fiction, obviously wrong in a picture, and it is the reason the deck read
    // as a flat grey band rather than as a structure. These are on a 15 m
    // spacing with a proper pier cap and a wider base, so it reads as a viaduct
    // carrying the road into the city.
    {
      const concrete = std("viaduct concrete", 0x8f8c86, { roughness: 0.88 });
      for (let px = -66; px <= 66; px += 15) {
        // tapered shaft: a 1.9 m column at the top into a 2.6 m footing, which is
        // what makes a pier look like it is holding something up
        mesh(new THREE.CylinderGeometry(0.95, 1.3, 7.4, 12), concrete, px, 3.7, 172, { cast: true });
        mesh(new THREE.BoxGeometry(3.4, 0.6, 3.0), concrete, px, 0.3, 172, { cast: true });
        // the pier cap, and the bearing pad the deck sits on
        mesh(new THREE.BoxGeometry(2.8, 0.5, 10.5), concrete, px, 7.65, 172, { cast: true });
        ctx.addBlocker(px, 172, 1.5);
      }
      // a fascia beam down each side of the deck, which is what stops the
      // underside reading as a floating rectangle from the street below
      for (const fz of [172 - 4.4, 172 + 4.4]) {
        mesh(new THREE.BoxGeometry(150, 1.5, 0.5), concrete, 0, 7.0, fz, { cast: true });
      }
    }
  }

  // ---------------------------------------------------------------- streets
  function buildStreets() {
    const concrete = ctx.surface("concrete", 1024);
    const side = concrete.material(1, { color: 0xb8b2a8 });
    const cw = CITY.maxX - CITY.minX, cd = CITY.maxZ - CITY.minZ + 4;
    for (const t of [side.map, side.normalMap, side.roughnessMap]) if (t) t.repeat.set(cw / 12, cd / 12);
    plane(cw, cd, side, 0, 0.012, (CITY.minZ + CITY.maxZ) / 2);

    const asphalt = ctx.surface("asphalt", 1024);
    const street = (w, d, x, z) => {
      const m = asphalt.material(1);
      for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) t.repeat.set(Math.max(1, w / 9), Math.max(1, d / 9));
      plane(w, d, m, x, 0.022, z);
    };
    for (const x of AVENUES) {
      // an avenue is cut where it crosses a superblock, not drawn through it
      const cuts = STREET_CUTS.filter((r) => !r.streetsOnly && x > r.x0 - STREET_W && x < r.x1 + STREET_W);
      let from = CITY.minZ;
      for (const r of cuts.sort((a, b) => a.z0 - b.z0)) {
        if (r.z0 > from) street(STREET_W, r.z0 - from, x, (from + r.z0) / 2);
        from = r.z1;
      }
      if (CITY.maxZ > from) street(STREET_W, CITY.maxZ - from, x, (from + CITY.maxZ) / 2);
    }
    for (const z of STREETS) {
      const cuts = STREET_CUTS.filter((r) => z > r.z0 - STREET_W && z < r.z1 + STREET_W);
      let from = CITY.minX;
      for (const r of cuts.sort((a, b) => a.x0 - b.x0)) {
        if (r.x0 > from) street(r.x0 - from, STREET_W, (from + r.x0) / 2, z);
        from = r.x1;
      }
      if (CITY.maxX > from) street(CITY.maxX - from, STREET_W, (from + CITY.maxX) / 2, z);
    }

    // Lane paint. This is what the "the traffic drives in the middle of the
    // road" report actually was: the cars were always in correct lanes (traffic.js
    // offsets each side by 2.4 m), but these streets were 9 m of bare asphalt
    // with nothing painted on them, so a car 2.4 m off the centreline of an
    // unmarked road reads as a car driving down the middle. Markings were built
    // for OrleaRouge and never wired into it — metro.js and orleafeinge.js both
    // call createMarkings(), orlearouge.js was the only district that did not.
    //
    // Two lanes each way, median 0 (no painted centreline on a street this
    // narrow), 2.4 m lanes: exactly the geometry makeRoadway() produces for the
    // arterials at z 250/330/410 and for metro.js's STREET_ROAD, so the paint and
    // the cars agree instead of merely looking plausible.
    // `ctx.markings` being present is NOT enough to call `.roadway()` on it: the
    // test harnesses pass ctx through a Proxy whose get() returns a function for
    // any key it does not know, so a missing `markings` reads as a truthy
    // non-markings object and this threw "M.roadway is not a function" inside
    // the district build. The harnesses that swallowed that error went on to
    // report every later check as passing. So check the method, not the key.
    if (ctx.markings && typeof ctx.markings.roadway === "function") {
      const M = ctx.markings;
      const paint = (x0, z0, x1, z1) => {
        if (Math.abs(x1 - x0) < 6 && Math.abs(z1 - z0) < 6) return;   // a stub is not a road
        M.roadway({ lanes: 2, median: 0, laneWidth: 2.4, points: [[x0, z0], [x1, z1]], y: 0.03 });
      };
      for (const x of AVENUES) {
        const cuts = STREET_CUTS.filter((r) => !r.streetsOnly && x > r.x0 - STREET_W && x < r.x1 + STREET_W);
        let from = CITY.minZ;
        for (const r of cuts.sort((a, b) => a.z0 - b.z0)) {
          if (r.z0 - from > 6) paint(x, from, x, r.z0);
          from = r.z1;
        }
        if (CITY.maxZ - from > 6) paint(x, from, x, CITY.maxZ);
      }
      for (const z of STREETS) {
        const cuts = STREET_CUTS.filter((r) => z > r.z0 - STREET_W && z < r.z1 + STREET_W);
        let from = CITY.minX;
        for (const r of cuts.sort((a, b) => a.x0 - b.x0)) {
          if (r.x0 - from > 6) paint(from, z, r.x0, z);
          from = r.x1;
        }
        if (CITY.maxX - from > 6) paint(from, z, CITY.maxX, z);
      }
      // The river-edge service roads get NO paint: lanes exist there (traffic.js
      // runs them at z +/- 2.4) but nothing paves them — see buildStreets, which
      // only tarmacs AVENUES and STREETS, and neither list contains
      // SEAM.z0+18. So they are dirt, and a centreline on dirt would be worse
      // than no line at all. They are a road the moment somebody paves them.
      M.flush(scene);
    }

    // lamps: down the boulevard, along two French District streets, the promenade
    //
    // The boulevard run starts at 144, not 204, so it lights the arrival band
    // too. It used to start at 204 because the band was swamp and there was
    // nothing to light; the lamps stopping exactly at the old CITY.minZ was the
    // tell that the city began there. The spacing stays on the 40 m pitch.
    for (let z = 144; z < 376; z += 40) {
      ctx.addLitSpot({ x: ctx.ROAD_X + ctx.ROAD_HALF + 2, y: 6, z, warm: 0xffd9a0, power: 110, range: 26, pole: true });
    }
    for (const z of [250, 290]) {
      for (let x = -120; x <= 376; x += 40) { if (x > -10 && x < 176) continue; ctx.addLitSpot({ x, y: 5, z: z - STREET_W / 2 - 1.5, warm: 0xffc890, power: 90, range: 22, pole: true }); }
    }
    for (let x = -80; x <= 376; x += 40) ctx.addLitSpot({ x, y: 5, z: 378, warm: 0xffe0b0, power: 90, range: 22, pole: true });

    // ---------------------------------------------------------------- the
    // arrival band
    //
    // "Busy" is a street-level property, not a skyline one, and the two new
    // streets at z 130 and z 170 were getting no lamps, no parked cars and no
    // signage — so however many towers went in above them, the approach read as
    // an empty boulevard between two walls of glass. This is the dressing that
    // makes the band the main entrance rather than the edge of the city, and it
    // is deliberately on the same 40 m pitch as the grid so the street furniture
    // lines up with the blocks instead of floating between them.
    {
      // lamp pairs flanking the boulevard all the way down the band
      for (let z = 144; z <= 196; z += 40) {
        for (const x of [ctx.ROAD_X - ctx.ROAD_HALF - 2, ctx.ROAD_X + ctx.ROAD_HALF + 2]) {
          ctx.addLitSpot({ x, y: 6, z, warm: 0xffd9a0, power: 120, range: 28, pole: true });
        }
      }
      // and down both new cross-streets, at the intersections, so the corners
      // are the bright bits you drive through
      for (const z of [130, 170]) {
        for (let x = -80; x <= 240; x += 40) {
          if (x > ctx.ROAD_X - 14 && x < ctx.ROAD_X + 14) continue;   // the boulevard's own lamps cover the junction
          ctx.addLitSpot({ x, y: 5, z: z + STREET_W / 2 + 1.5, warm: 0xfff0cc, power: 95, range: 24, pole: true });
        }
      }
      // Parked cars along the kerb. This is the single cheapest thing that makes
      // a street read as used: not because the car is interesting, but because
      // the gaps between the cars are what the eye measures the road by. Plain
      // static boxes on the block side, clear of the carriageway, in the four
      // body colours a car park actually contains.
      const bodies = [0xb8bcc0, 0x2c3138, 0x6d1f24, 0x1e3a63, 0xd8d4c8, 0x3f4a3a];
      let ci = 0;
      for (let z = 138; z <= 200; z += 7) {
        for (const [x, flip] of [[ctx.ROAD_X - ctx.ROAD_HALF - 4, 0], [ctx.ROAD_X + ctx.ROAD_HALF + 4, 1]]) {
          // leave gaps: a solid line of cars reads as a wall, and every fourth
          // bay is empty because that is what a car park on a working street is
          if ((ci * 7) % 11 < 3) { ci++; continue; }
          const len = 4.2 + ((ci * 13) % 5) * 0.22, wid = 1.82;
          const g = new THREE.BoxGeometry(wid, 0.72, len);
          const car = mesh(g, std("parked car", bodies[ci % bodies.length], { metalness: 0.35, roughness: 0.42 }), x, 0.62, z);
          car.rotation.y = flip ? Math.PI / 2 : -Math.PI / 2;
          mesh(new THREE.BoxGeometry(wid - 0.16, 0.6, len * 0.5), std("car glass", 0x141a1f, { metalness: 0.5, roughness: 0.15 }), x, 1.26, z, { cast: true });
          ctx.addBlocker(x, z, 1.1);
          ci++;
        }
      }
      // A few street trees in the kerb strip, which is what stops the two new
      // streets reading as car parks with towers behind them.
      const trunk = std("street tree trunk", 0x5a4632, { roughness: 0.95 });
      const leaf = std("street tree crown", 0x47653a, { roughness: 0.92 });
      for (let z = 144; z <= 200; z += 40) {
        for (const x of [ctx.ROAD_X - ctx.ROAD_HALF - 8, ctx.ROAD_X + ctx.ROAD_HALF + 8]) {
          mesh(new THREE.CylinderGeometry(0.16, 0.24, 3.1, 8), trunk, x, 1.55, z, { cast: true });
          mesh(new THREE.IcosahedronGeometry(1.75, 0), leaf, x, 4.0, z, { cast: true });
          ctx.addBlocker(x, z, 0.5);
        }
      }
    }

    // the welcome, with a reply from Keseme's own narration
    ctx.makeBillboard(ctx.ROAD_X + ctx.ROAD_HALF + 7, 199, Math.PI, "ORLEAROUGE", POP_TEXT + " · Life Is Beautiful", "BEAUTY DON'T MAKE YOU SAFE");
  }

  /** Blocks between streets: [x0, x1, z0, z1] with a sidewalk margin. */
  function blocks() {
    // Split the avenues on the BOULEVARD, not by index. `slice(0, 2)` was a way
    // of saying "the two on either side of US-167" that stopped being true the
    // moment an avenue was added west of the city, and it fails silently: the
    // grid comes out with the wrong xs and every block is in the wrong place.
    // Side-of-the-road is the actual property, and ROAD_X can move.
    const roadX = ctx.ROAD_X;
    // …which is a NUMBER, and this is the only place in the repo that says so.
    //
    // Every headless harness in tools/qa passes ctx a Proxy whose fallback for an
    // unknown key is a no-op FUNCTION, so a harness that forgets ROAD_X hands
    // this module a function. `x < roadX` is then a comparison with NaN: false
    // for every avenue, so `west` comes back empty and the city is built with
    // no western half at all. Nothing throws, nothing warns, and the harness
    // prints a confident table — that has now happened four times in this repo
    // and the fourth time it turned a survey of OrleaRouge into a survey of a
    // city that does not exist. A missing coordinate is not a thing this module
    // is willing to guess at.
    if (typeof roadX !== "number") {
      throw new Error("[orlearouge] ctx.ROAD_X must be a number (it is " + typeof roadX +
        "). A harness that omits it gets a Proxy fallback of noop(), which is a " +
        "function, and the whole western half of the grid silently disappears.");
    }
    const west = AVENUES.filter((x) => x < roadX);
    const east = AVENUES.filter((x) => x > roadX);
    const xs = [CITY.minX, ...west, roadX, ...east, CITY.maxX];
    const zs = [CITY.minZ, ...STREETS, CITY.maxZ];
    const out = [];
    // A reserve spans many grid cells, and every one of them reports its
    // midpoint as inside it. Without this the Superdome's 260 m superblock was
    // emitted sixteen times over and the stadium was built sixteen times inside
    // itself — so the set piece is emitted ONCE, at its full extent, and every
    // later cell that lands in it is skipped.
    const emitted = new Set();
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        // Pad every plot back from its street centreline by half the carriageway
        // plus a margin, INCLUDING at the city edge.
        //
        // The edge case used to pad by 1 m, on the reasoning that a plot at the
        // city boundary has no street across it and so needs no clearance. But
        // STREET_W/2 + 2.5 is the clearance from the CENTRELINE, and the
        // outermost street is not outside the plot — it runs along it. So the
        // southern and northern rows, and the eastern and western ones, got a
        // 1 m setback from a road that is 4.5 m half-width, and their buildings,
        // fences, kerbside props and parked cars were built INSIDE the
        // carriageway. That is the "buildings in the middle of the road"
        // screenshot, and it is 81 blockers on OrleaRouge 130 alone — the
        // street at CITY.minZ, added with the arrival band, which is why it was
        // the worst of them. The margin does not exist to give a perimeter
        // building room from a road that is not there; it exists to keep
        // buildings out of the one that IS.
        const pad = () => STREET_W / 2 + 2.5;
        const x0 = xs[i] + pad() + (xs[i] === ctx.ROAD_X ? 1 : 0), x1 = xs[i + 1] - pad() - (xs[i + 1] === ctx.ROAD_X ? 1 : 0);
        const z0 = zs[j] + pad(), z1 = zs[j + 1] - pad();
        if (x1 - x0 <= 8 || z1 - z0 <= 6) continue;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        // The seam is riverEdge()'s, whole: canal, rail, two service roads, sheds.
        // The grid did not reach it while CITY.minZ was 196, and when the city
        // grew north to 130 its cells landed on top of it — the gateway then built
        // bank houses and warehouses through the sheds and across River Edge 150.
        if (mx > SEAM.x0 && mx < SEAM.x1 && mz > SEAM.z0 && mz < SEAM.z1) continue;
        // A superblock is ONE plot, not a row of them. It is emitted at its full
        // reserve extent so a landmark can find it by coordinate and fill it.
        const reserve = RESERVES.find((r) => mx > r.x0 && mx < r.x1 && mz > r.z0 && mz < r.z1);
        if (reserve) {
          if (emitted.has(reserve.label)) continue;
          emitted.add(reserve.label);
          out.push({ x0: reserve.x0, x1: reserve.x1, z0: reserve.z0, z1: reserve.z1, cx: (reserve.x0 + reserve.x1) / 2, cz: (reserve.z0 + reserve.z1) / 2, reserve: true, label: reserve.label });
          continue;
        }
        out.push({ x0, x1, z0, z1, cx: mx, cz: mz });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- French District
  const PASTELS = [0xd98e73, 0xe8c98a, 0x9cc7b4, 0xc9a0c7, 0xe6b0a0, 0x8fb3d9, 0xefe4cf];
  function rowhouse(x, z, w, faceZ, floors) {
    const h = floors * 3.3 + 0.6, d = 9;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = faceZ < 0 ? Math.PI : 0;              // front faces the street
    scene.add(g);
    const wall = std("stucco wall", PASTELS[(Math.abs(Math.round(x * 7 + z * 3))) % PASTELS.length]);
    const trim = std("trim wood", 0xf2eee4);
    const iron = std("wrought iron railing", 0x1c1f22, { metalness: 0.6, roughness: 0.5 });
    const shutter = std("shutter wood", 0x2f5a44);
    mesh(new THREE.BoxGeometry(w, h, d), wall, 0, h / 2, 0, { parent: g });
    mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), trim, 0, h + 0.25, 0, { parent: g });
    const lit = basic(new THREE.Color(0xffc27a).multiplyScalar(1.5));
    const dark = basic(0x17202a);
    for (let f = 0; f < floors; f++) {
      const y = 1.9 + f * 3.3;
      for (const wx of [-w * 0.28, w * 0.28]) {
        mesh(new THREE.BoxGeometry(1.2, 2.0, 0.1), (x + z + f + wx) % 3 > 1 ? dark : lit, wx, y, d / 2 + 0.02, { parent: g, cast: false });
        mesh(new THREE.BoxGeometry(0.45, 2.1, 0.08), shutter, wx - 0.85, y, d / 2 + 0.05, { parent: g, cast: false });
        mesh(new THREE.BoxGeometry(0.45, 2.1, 0.08), shutter, wx + 0.85, y, d / 2 + 0.05, { parent: g, cast: false });
      }
      if (f > 0) {
        // the balcony: slab, top rail and a row of balusters
        mesh(new THREE.BoxGeometry(w - 0.4, 0.18, 1.3), trim, 0, y - 1.15, d / 2 + 0.65, { parent: g });
        mesh(new THREE.BoxGeometry(w - 0.4, 0.07, 0.07), iron, 0, y - 0.1, d / 2 + 1.25, { parent: g, cast: false });
        const balusters = Math.max(4, Math.round(w / 0.9));
        for (let b = 0; b <= balusters; b++) {
          mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), iron, -w / 2 + 0.3 + b * (w - 0.6) / balusters, y - 0.6, d / 2 + 1.25, { parent: g, cast: false });
        }
      }
    }
    occluders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h + 0.5, minZ: z - d / 2 - 1.3, maxZ: z + d / 2 + 1.3 });
    blockBlocker(x - w / 4, z, Math.min(w / 2, d / 2));
    blockBlocker(x + w / 4, z, Math.min(w / 2, d / 2));
    return g;
  }

  const CLUBS = [
    ["ROUGE ROYALE JAZZ", "#2ee6ff", "#1a0f24"], ["24 HR DAIQUIRIS", "#ff4fb3", "#1a0f1a"],
    ["BRASS & BOURBON", "#ffc23a", "#1a1408"], ["LE CRAWFISH CLUB", "#ff5a3c", "#140a08"],
    ["MUSIC HALL", "#9dff6a", "#0c140a"], ["PO-BOYS · BEIGNETS", "#ffe07a", "#1a1408"],
  ];
  /**
   * A block's collision, kept out of the boulevard.
   *
   * These are single circles inscribed in a rectangular block, and a block that
   * runs up to US-167 puts its circle's edge into the carriageway. One at
   * (-18.5, 350) reached 3.5 m in and pinched a 10 m highway down to 4.25 m for
   * a 3.6 m car — with no mesh anywhere near it, so it was an invisible
   * obstacle in the road as well as a narrow one.
   *
   * The radius is shrunk, never the building: only the circle over-reaches. A
   * blocker that does not touch the carriageway is returned untouched.
   */
  function blockBlocker(cx, cz, r) {
    // Clamp against EVERY carriageway the circle can reach, not just the boulevard.
    //
    // This only ever knew about US-167, and fixed a real bug: one at (-18.5, 350)
    // reached 3.5 m into the highway and pinched a 10 m road to 4.25 m for a 3.6 m car,
    // as an invisible obstacle in the road with no mesh near it. Good fix, wrong scope --
    // the same over-reach happens at every AVENUE and every STREET, because a circle
    // inscribed in a rectangular block reaches half its radius past the plot edge, and
    // the plot edge is only pad() = STREET_W/2 + 2.5 = 7 m from the centreline while the
    // carriageway is STREET_W/2 = 4.5 m. That leaves 2.5 m of slack, which a 5 m radius
    // spends and a 10 m radius blows straight through.
    //
    // MEASURED by tools/qa/city_road_clearance.mjs before this fix: 100 building-sized
    // static blockers overlapping a carriageway, spread across a dozen different roads
    // (z=170, x=-86, x=554, x=194, x=-206, x=-126, x=-286, x=514, x=-246...). One
    // shared cause, one fix. Worst was (617, 330) reaching 23.7 m into the street z=330.
    //
    // So: shrink the circle against the NEAREST carriageway in each axis. The radius is
    // still never the building's -- only the circle over-reaches, and shrinking it keeps
    // collision working while getting the obstacle out of the road.
    const kerbW = ctx.ROAD_X - ctx.ROAD_HALF - 1;
    const kerbE = ctx.ROAD_X + ctx.ROAD_HALF + 1;
    let rr = r;
    if (cx <= kerbW) rr = Math.min(rr, kerbW - cx);
    else if (cx >= kerbE) rr = Math.min(rr, cx - kerbE);

    // The grid. AVENUES are north-south, STREETS are east-west; a circle only needs to
    // clear the carriageway whose CENTRELINE it is nearest in the axis it can spill along.
    // Measuring against the nearest line in x handles the avenues, and in z the streets.
    // KERB is the distance from the centreline to the edge of the tarmac plus a little
    // so the circle ends at the kerb rather than exactly on it.
    const KERB = STREET_W / 2 + 0.5;
    for (const ax of AVENUES) {
      const off = Math.abs(cx - ax);
      if (off < rr + KERB) rr = Math.max(0, Math.min(rr, off - KERB));
    }
    for (const sz of STREETS) {
      const off = Math.abs(cz - sz);
      if (off < rr + KERB) rr = Math.max(0, Math.min(rr, off - KERB));
    }
    // And the same for the far edges of the rect, which carry no ribbon but are where a
    // perimeter block's circle would otherwise sit with nothing to stop it.
    if (cx - rr < CITY.minX) rr = Math.max(0, cx - CITY.minX);
    if (cx + rr > CITY.maxX) rr = Math.max(0, CITY.maxX - cx);
    if (cz - rr < CITY.minZ) rr = Math.max(0, cz - CITY.minZ);
    if (cz + rr > CITY.maxZ) rr = Math.max(0, CITY.maxZ - cz);

    if (rr > 0.4) ctx.addBlocker(cx, cz, rr);
  }

  /**
   * The alley behind a block's frontage: the strip between two rows of houses
   * that every plan draws as an empty rectangle and every person who walks round
   * the back reads as a car park.
   *
   * It is the same vocabulary the West Bank's backland uses, at the scale a
   * French Quarter alley actually is — 8 m of wet tarmac between two 9 m-deep
   * terraces — so the dressing is things that FIT an 8 m gap: bins against a
   * wall, condensers under a window, a rear wing, laundry across the gap, one
   * car that came round the back. Nothing here is a building and nothing is
   * meant to be seen from the street; that is the point of it.
   *
   * `g` may be null for a block whose frontage is loose meshes (the Quarter's
   * rowhouses parent themselves to the scene), in which case the dressing goes
   * to the scene too.
   */
  function alleyDress(b, z0, z1, g = null, seed = 0) {
    if (z1 - z0 < 3) return;
    alleys.push({ x0: b.x0, x1: b.x1, z0, z1, label: b.label || "alley" });
    const parent = g || scene;
    const x0 = b.x0 + 1, x1 = b.x1 - 1, w = x1 - x0;
    const zc = (z0 + z1) / 2, d = z1 - z0;
    // wet tarmac, because an alley in this city is never dry
    const surf = ctx.surface("asphalt", 1024);
    const m = surf.material(1);
    for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) t.repeat.set(Math.max(1, w / 9), Math.max(1, d / 6));
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(b.cx, 0.03, zc);
    slab.receiveShadow = true;
    parent.add(slab);
    // a kerb line down each side, so the alley is a space and not a stain
    const kerb = std("alley kerb", 0x9a958c, { roughness: 0.95 });
    for (const z of [z0 + 0.2, z1 - 0.2]) mesh(new THREE.BoxGeometry(w, 0.14, 0.4), kerb, b.cx, 0.07, z, { cast: false, parent });

    // dressing, laid down the alley in a deterministic order
    const bin = std("dumpster", 0x2f4a3a), binLid = std("dumpster lid", 0x24382c);
    const cond = std("air conditioner", 0x8d8a84, { metalness: 0.4, roughness: 0.7 });
    const brick = std("rear wing brick", 0x7a4a3a);
    const step = std("back step", 0xa8a294);
    const lamp = basic(new THREE.Color(0xffc98a).multiplyScalar(1.6));
    let x = x0 + 2.5;
    let i = seed;
    while (x < x1 - 3) {
      const roll = hashf(x, zc, 61 + i);
      const northSide = hashf(x, zc, 62 + i) < 0.5;
      const zEdge = northSide ? z0 + 1.1 : z1 - 1.1;
      if (roll < 0.30) {
        // a dumpster, on its own two feet of slab
        mesh(new THREE.BoxGeometry(2.3, 1.25, 1.35), bin, x, 0.72, zEdge, { cast: true, parent });
        mesh(new THREE.BoxGeometry(2.4, 0.12, 1.45), binLid, x, 1.38, zEdge, { cast: false, parent });
        ctx.addBlocker(x, zEdge, 1.3);
        if (ctx.makeBarrel) ctx.makeBarrel(x + 1.9, zEdge + 0.4);
      } else if (roll < 0.52) {
        // a condenser under a window, and the brackets that hold it up
        mesh(new THREE.BoxGeometry(0.95, 0.8, 0.8), cond, x, 2.6, zEdge, { cast: false, parent });
        for (const bx of [-0.4, 0.4]) mesh(new THREE.BoxGeometry(0.08, 0.5, 0.7), cond, x + bx, 2.1, zEdge, { cast: false, parent });
        mesh(new THREE.BoxGeometry(0.14, 0.22, 0.6), step, x, 0.11, zEdge + (northSide ? 0.9 : -0.9), { cast: false, parent });
      } else if (roll < 0.64) {
        // a rear wing: a low brick extension with a tin roof
        const wd = Math.min(5.5, d - 2.2);
        mesh(new THREE.BoxGeometry(4.2, 3.1, wd), brick, x, 1.55, zEdge, { parent });
        mesh(new THREE.BoxGeometry(4.6, 0.16, wd + 0.5), step, x, 3.15, zEdge, { parent });
        ctx.addBlocker(x, zEdge, Math.max(1.6, wd / 2));
      } else if (roll < 0.80) {
        // laundry: a line across the alley with three things pegged to it
        const h = 2.6 + hashf(x, zc, 63 + i) * 0.6;
        const span = Math.min(w - 2, 7);
        mesh(new THREE.BoxGeometry(span, 0.04, 0.04), cond, x, h, zc, { cast: false, parent });
        for (let k = 0; k < 3; k++) {
          const t = hashf(x, zc, 64 + i * 3 + k);
          mesh(new THREE.PlaneGeometry(0.9, 1.2 + t * 0.5),
            basic(new THREE.Color([0xe8e2d4, 0xd8c8b0, 0xc8d4dc, 0xe0c0c8][k % 4])),
            x - span / 2 + 1.2 + k * 2.2, h - 0.75, zc, { cast: false, parent });
        }
      } else if (roll < 0.90) {
        // a bulkhead lamp over a back door — emissive only, because the real
        // point light pool is capped and an alley is not worth one of eight
        mesh(new THREE.BoxGeometry(0.3, 0.22, 0.24), lamp, x, 2.9, zEdge, { cast: false, parent });
      }
      x += 4.5 + hashf(x, zc, 65 + i) * 2.5;
      i++;
    }
    // one car that came round the back, on a third of the alleys
    if (hashf(b.cx, zc, 66 + seed) < 0.34) {
      const car = std("alley car", [0x8a2f2f, 0x2f4a8a, 0xb0b0b4, 0x3a5a3a, 0xd8d4c8][Math.floor(hashf(b.cx, zc, 67 + seed) * 5)]);
      mesh(new THREE.BoxGeometry(1.9, 1.35, 4.2), car, b.cx + (hashf(b.cx, zc, 68 + seed) - 0.5) * w * 0.5, 0.78, zc,
        { cast: true, parent, ry: Math.PI / 2 });
      ctx.addBlocker(b.cx, zc, 1.1);
    }
    pois.push({ x: b.cx, z: zc, r: Math.min(6, d * 0.5), label: "back alley" });
  }

  function outskirts(bl) {
    let outRng = 0;
    for (const b of bl) {
      if (zoneOf(b, ctx.ROAD_X) !== "edge") continue;
      
      const w = b.x1 - b.x0;
      const d = b.z1 - b.z0;
      outRng++;
      
      if (outRng % 3 === 0) {
        // Run-down warehouse
        mesh(new THREE.BoxGeometry(w - 2, 8, d - 4), std("warehouse metal", 0x4a4e54, { metalness: 0.5, roughness: 0.8 }), b.cx, 4, b.cz);
        mesh(new THREE.BoxGeometry(w, 1, d - 2), std("warehouse roof", 0x222222), b.cx, 8.5, b.cz);
        blockBlocker(b.cx, b.cz, Math.min(w, d) / 2 - 1);
        if (ctx.makePallet) {
          ctx.makePallet(b.x0 + 4, b.z0 + 2, 0);
          ctx.makePallet(b.x0 + 4, b.z0 + 4, 0);
        }
        if (ctx.makeBarrel) {
          ctx.makeBarrel(b.x1 - 3, b.z0 + 2);
          ctx.makeBarrel(b.x1 - 4, b.z0 + 2.5);
        }
      } else if (outRng % 3 === 1) {
        // Cheap Motel
        mesh(new THREE.BoxGeometry(w - 4, 5, 8), std("motel plaster", 0xc8c3b5), b.cx, 2.5, b.cz - d/4);
        mesh(new THREE.BoxGeometry(w - 4, 5, 8), std("motel plaster", 0xc8c3b5), b.cx, 2.5, b.cz + d/4);
        ctx.addBlocker(b.cx, b.cz - d/4, 4);
        ctx.addBlocker(b.cx, b.cz + d/4, 4);
        
        neonSign("VACANCY", "#ff3333", "#220000", 6, 1.2, b.cx, 6, b.cz, 0, 0.2);
        
        if (ctx.makeFence) {
          ctx.makeFence(b.x0, b.z0, b.x0, b.z1);
          ctx.makeFence(b.x1, b.z0, b.x1, b.z1);
        }
        // the yard between the two motel runs, which on a 26 m plot is 18 m of
        // nothing: parking, an ice machine, a line of planters
        const yardD = d / 2 - 8;
        if (yardD > 3) {
          const conc = std("motel lot concrete", 0x5a5751, { roughness: 0.97 });
          mesh(new THREE.BoxGeometry(w - 5, 0.06, yardD), conc, b.cx, 0.04, b.cz, { cast: false });
          for (let i = 0; i < 5; i++) {
            mesh(new THREE.BoxGeometry(1.9, 1.35, 4.2),
              std("parked car", [0x8a2f2f, 0x2f4a8a, 0xb0b0b4, 0x3a5a3a, 0xd8d4c8][(outRng + i) % 5]),
              b.x0 + 5 + i * ((w - 10) / 4), 0.78, b.cz, { cast: false, ry: Math.PI / 2 });
          }
          mesh(new THREE.BoxGeometry(1.2, 1.5, 1.0), std("ice machine", 0xb8c4c8), b.cx + w / 2 - 4, 0.75, b.cz, { cast: false });
          for (let i = 0; i < 4; i++) {
            mesh(new THREE.BoxGeometry(1.2, 0.6, 1.2), std("planter", 0x6a5a48), b.x0 + 4 + i * 3, 0.3, b.cz + yardD / 2 - 1, { cast: false });
          }
          pois.push({ x: b.cx, z: b.cz, r: 6, label: "motel lot" });
        }
      } else {
        // Row of shotgun houses
        const num = Math.max(1, Math.floor(w / 8));
        const houseW = 5;
        const houseD = 14;
        const step = w / num;
        const roofGeo = new THREE.CylinderGeometry(houseW / 1.5, houseW / 1.5, houseD + 1, 3).rotateX(-Math.PI / 2).translate(0, 0.5, 0);
        for (let i = 0; i < num; i++) {
          const hx = b.x0 + step * (i + 0.5);
          const color = [0x556655, 0x775555, 0x444466, 0x666655][(outRng + i) % 4];
          mesh(new THREE.BoxGeometry(houseW, 4, houseD), std("shotgun wood", color), hx, 2, b.cz);
          mesh(roofGeo, std("shingle", 0x2a2a2a), hx, 4, b.cz);
          ctx.addBlocker(hx, b.cz, houseW / 1.5);
        }
      }
    }
  }

  function frenchDistrict(bl) {
    let club = 0;
    for (const b of bl) {
      if (zoneOf(b, ctx.ROAD_X) !== "quarter") continue;
      for (const faceZ of [-1, 1]) {
        const zEdge = faceZ < 0 ? b.z0 + 4.5 : b.z1 - 4.5;
        const n = Math.max(1, Math.floor((b.x1 - b.x0) / 9));
        const w = (b.x1 - b.x0) / n;
        for (let i = 0; i < n; i++) {
          const x = b.x0 + w * (i + 0.5);
          rowhouse(x, zEdge, w - 0.3, faceZ, 2 + ((i + Math.round(b.cz)) % 2));
          if ((i + club) % 3 === 0) {
            const [text, ink, bg] = CLUBS[club++ % CLUBS.length];
            neonSign(text, ink, bg, Math.min(w - 1, 7), 1.4, x, 3.4, zEdge + faceZ * 5.2, faceZ < 0 ? Math.PI : 0, 0.12);
            pois.push({ x, z: zEdge + faceZ * 7, r: 5 });
          }
        }
      }
      // …and the alley the two terraces leave between them. `rowhouse` is 9 m
      // deep and a plot is 26, so every block in the Quarter had 8 m of bare
      // pavement down its middle with a row of houses 4 m either side of it. That
      // is a real alley and it was drawn as a stain.
      alleyDress(b, b.z0 + 9.6, b.z1 - 9.6, null, Math.round(b.cx + b.cz));
    }
  }

  // ---------------------------------------------------------------- the West Bank
  //
  // The five columns the grid grew westward into, and the edge the city now ends
  // on. It is the West Bank because that is what is on the far side of a
  // Mississippi from a city built on one bank: not a second downtown and not
  // open country, but LOW — one and two storey, wide plots, working yards, the
  // odd brick works with a stack, and everywhere a chain-link fence and a
  // gravel apron where the car parks and the back steps are.
  //
  // It is the district that has to be built, because the alternative is the
  // 9.7 ha of nothing it replaced: a field west of the French Quarter at the
  // same latitude as the skyline, which is exactly the shape an aerial reads as
  // a hole in the map. Filling it with more towers would be worse — the point is
  // that you can see the CBD from the water, which is why the floodwall is the
  // last thing out.
  const WB_WALL = [0x6d5b4a, 0x7a6a52, 0x5f5a4e, 0x74624e];
  const WB_TRIM = [0xd8cfbe, 0xc9bda6, 0xe0d6c4];

  /** A low West Bank house: two storeys, a porch, a pitched roof, a back step. */
  function bankHouse(g, x, z, w, d, h, faceZ, seed) {
    const wall = std("west bank plaster", WB_WALL[Math.floor(hashf(x, z, seed) * WB_WALL.length)]);
    const trim = std("west bank trim", WB_TRIM[Math.floor(hashf(x, z, seed + 1) * WB_TRIM.length)]);
    const roof = std("west bank roof shingle", 0x3a3530);
    mesh(new THREE.BoxGeometry(w, h, d), wall, x, h / 2, z, { parent: g });
    mesh(new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3), trim, x, h + 0.2, z, { parent: g });
    // a hipped roof rather than a flat one, which is the whole silhouette
    const cap = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.5, 4).rotateY(Math.PI / 4),
      roof, x, h + 0.95, z, { parent: g });
    cap.scale.set(w / (Math.max(w, d) * 0.78 * 1.414), 1, d / (Math.max(w, d) * 0.78 * 1.414));
    // the porch: two posts, a roof and a step, on the street side
    const fz = z + faceZ * (d / 2);
    mesh(new THREE.BoxGeometry(w * 0.8, 0.16, 1.6), trim, x, 2.5, fz + faceZ * 0.8, { parent: g, cast: false });
    for (const px of [-w * 0.34, w * 0.34]) {
      mesh(new THREE.BoxGeometry(0.14, 2.5, 0.14), trim, x + px, 1.25, fz + faceZ * 1.5, { parent: g, cast: false });
    }
    mesh(new THREE.BoxGeometry(w * 0.84, 1.6, 0.12), std("west bank door", 0x2e3a34), x, 0.8, fz + faceZ * 0.06, { parent: g, cast: false });
    blockBlocker(x, z, Math.min(w, d) / 2 - 0.4);
  }

  /**
   * The middle of a plot behind its frontage: a gravel apron, the cars, the
   * bins, the sheds and the fence.
   *
   * This is the part of a block a plan draws as an empty rectangle and a person
   * walking round the back reads as a car park. It is cheap — a slab, some boxes
   * and a fence — and it is the difference between a district that is built and
   * one that is only built where you can see it.
   */
  function backland(g, b, w, d, seed) {
    const apronD = Math.min(d - 8, 12);
    mesh(new THREE.BoxGeometry(w - 6, 0.06, apronD),
      std("backland gravel", 0x53504a, { roughness: 0.99 }), b.cx, 0.04, b.cz, { parent: g, cast: false });
    // a car or two, drawn as the box the rest of this file draws them as
    const nCar = 2 + Math.floor(hashf(b.cx, b.cz, seed + 5) * 3);
    for (let i = 0; i < nCar; i++) {
      const px = b.x0 + 5 + hashf(b.cx + i, b.cz, seed + i) * Math.max(1, w - 10);
      const pz = b.cz + (hashf(b.cx, b.cz + i, seed + i) - 0.5) * (apronD - 5);
      mesh(new THREE.BoxGeometry(1.9, 1.35, 4.2),
        std("parked car", [0x8a2f2f, 0x2f4a8a, 0xb0b0b4, 0x3a5a3a, 0xd8d4c8][i % 5]),
        px, 0.78, pz, { parent: g, cast: false });
    }
    // bins, a shed and a fence line down the back of the plot
    if (ctx.makeBarrel) { ctx.makeBarrel(b.x0 + 4, b.cz + 3); ctx.makeBarrel(b.x0 + 5.2, b.cz + 3.4); }
    if (ctx.makePallet) { ctx.makePallet(b.x1 - 5, b.cz - 2, 0); ctx.makePallet(b.x1 - 5, b.cz + 0.4, 0); }
    if (hashf(b.cx, b.cz, seed + 7) < 0.5) {
      mesh(new THREE.BoxGeometry(3.4, 2.4, 2.6), std("backland shed", 0x6a5f52), b.x1 - 5.5, 1.2, b.cz + 2.5, { parent: g });
      blockBlocker(b.x1 - 5.5, b.cz + 2.5, 1.7);
    }
    if (ctx.makeFence) {
      ctx.makeFence(b.x0 + 2, b.z1 - 2, b.x1 - 2, b.z1 - 2);
    }
  }

  function westBank(bl) {
    let v = 0;
    for (const b of bl) {
      if (zoneOf(b, ctx.ROAD_X) !== "westbank") continue;
      const g = buildingGroup(b);
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      const roll = hashf(b.cx, b.cz, 41);
      if (roll < 0.20) {
        // a brick works: a long low shed, a stack, and a tank
        mesh(new THREE.BoxGeometry(w - 5, 8, 12), std("west bank works brick", 0x6b4a3c), b.cx, 4, b.z0 + 9, { parent: g });
        mesh(new THREE.BoxGeometry(w - 4, 0.6, 13), std("west bank works roof", 0x2e2a26), b.cx, 8.3, b.z0 + 9, { parent: g });
        mesh(new THREE.CylinderGeometry(1.5, 1.9, 16, 12), std("brick stack", 0x7a4a3a), b.cx + w / 2 - 5, 8, b.z0 + 9, { parent: g });
        blockBlocker(b.cx, b.z0 + 9, 6);
        blockBlocker(b.cx + w / 2 - 5, b.z0 + 9, 1.9);
        backland(g, b, w, d, v);
      } else if (roll < 0.34) {
        // a hall with a tower: a church, a school, a union hall — the reason
        // there is a spike on the skyline out here at all
        mesh(new THREE.BoxGeometry(w - 8, 7.5, 14), std("west bank hall stucco", 0xcfc4ae), b.cx, 3.75, b.cz - 2, { parent: g });
        mesh(new THREE.BoxGeometry(5, 13, 5), std("west bank tower", 0xbfb49e), b.cx - w / 4, 6.5, b.cz - 2, { parent: g });
        const spire = mesh(new THREE.ConeGeometry(3.4, 7, 4).rotateY(Math.PI / 4), std("west bank spire", 0x4a4640), b.cx - w / 4, 16.5, b.cz - 2, { parent: g });
        spire.castShadow = true;
        blockBlocker(b.cx, b.cz - 2, 5.5);
        blockBlocker(b.cx - w / 4, b.cz - 2, 2.6);
        backland(g, b, w, d, v);
      } else if (roll < 0.50) {
        // a working yard: hard standing, containers, a stack of pipe
        mesh(new THREE.BoxGeometry(w - 5, 0.08, d - 6), std("yard concrete", 0x5c5a55, { roughness: 0.96 }), b.cx, 0.04, b.cz, { parent: g, cast: false });
        for (let i = 0; i < 4; i++) {
          const px = b.x0 + 5 + i * ((w - 10) / 3), pz = b.cz + (i % 2 ? 3 : -3);
          mesh(new THREE.BoxGeometry(2.4, 2.6, 6), std("shipping container", [0x2f5a6a, 0x6a3a2f, 0x3a5a3a][i % 3]), px, 1.3, pz, { parent: g });
          blockBlocker(px, pz, 1.4);
        }
        if (ctx.makeFence) {
          ctx.makeFence(b.x0 + 1, b.z0 + 1, b.x1 - 1, b.z0 + 1);
        }
        // and a house on the street so the block is not a compound in a void
        bankHouse(g, b.cx - w / 4, b.z0 + 5, 7, 9, 5, 1, v);
      } else {
        // houses on both street frontages and the yard between them, which is
        // the ordinary West Bank block and the majority of them
        const n = Math.max(1, Math.floor((w - 4) / 9));
        const hw = (w - 4) / n;
        for (let i = 0; i < n; i++) {
          bankHouse(g, b.x0 + 2 + hw * (i + 0.5), b.z0 + 7, hw - 1.2, 11, 5.5 + ((i + v) % 2) * 2.6, 1, v * 7 + i);
          if (hashf(b.cx + i, b.cz, 51) < 0.6) bankHouse(g, b.x0 + 2 + hw * (i + 0.5), b.z1 - 7, hw - 1.2, 11, 5.5 + ((i + v) % 2) * 2.6, -1, v * 11 + i);
        }
        backland(g, b, w, d, v);
      }
      pois.push({ x: b.cx, z: b.z0 - 4, r: 6 });
      v++;
    }
  }

  /**
   * The levee: the wall the city ends on.
   *
   * Every city on a flood plain is bounded by one, and it is the correct thing to
   * end a grid on for a second reason as well — the floodwall is a 2.5 m
   * concrete kerb running the length of the west edge, so the western approach
   * has a LINE to it instead of dissolving into a field. Beyond it is the river
   * side of the West Bank: a rail spur, a couple of warehouses and the swamp.
   */
  /**
   * True if (x, z) is on Parish Highway 9, if anybody asked.
   *
   * The highway is defined in westparish.js, which imports THIS module for the
   * city's bounds, so the question cannot be asked by importing it — the loop
   * kills every module in it on `METRO_BOUNDS`. main.js has both and passes the
   * query in on ctx. A harness that does not is answering "no", which draws a
   * continuous wall and a canal that runs under a road: the wrong answer, but a
   * buildable one, and the alternative (throwing) would stop every probe in the
   * repo from building the city at all.
   */
  const onHwy = (x, z, pad = 0) => typeof ctx.onParishHighway === "function" && ctx.onParishHighway(x, z, pad) === true;

  /**
   * The stretches of floodwall that are actually wall: the full run minus every
   * place a road crosses it. Exported and pure so it can be tested without
   * building a city, because the whole point of it is a case that only shows up
   * when a highway happens to run through the middle of the wall.
   */
  function leveeRuns(x, z0, z1, hit = onHwy, step = 2) {
    const runs = [];
    let start = null;
    for (let z = z0; z <= z1; z += step) {
      const open = hit(x, z, 7);
      if (!open && start === null) start = z;
      if ((open || z >= z1) && start !== null) { runs.push([start, Math.min(z, z1)]); start = null; }
    }
    if (start !== null) runs.push([start, z1]);
    return runs.filter(([a, b]) => b - a >= step);
  }

  function levee() {
    const x = LEVEE.x;
    // The wall runs from the seam's north edge, not the city's, so that the
    // river edge below joins onto it instead of stopping 64 m short of where the
    // city starts. One line from the water to the far end of the grid.
    const z0 = SEAM.z0 + 4, z1 = CITY.maxZ;
    const wall = std("levee floodwall", 0xa8a196, { roughness: 0.94 });
    // …in RUNS, because Parish Highway 9 crosses it. A floodwall with a road
    // driven through it is not a floodwall; a floodwall with a gate opening in
    // it is exactly what is on the river crossings in this city.
    const runs = leveeRuns(x, z0, z1);
    for (const [a, b] of runs) {
      if (b - a < 1) continue;
      mesh(new THREE.BoxGeometry(1.6, 2.6, b - a), wall, x, 1.3, (a + b) / 2, { cast: true });
      for (let z = a; z < b; z += 3) ctx.addBlocker(x, z, 1);
    }
    // and a gate tower either side of every gap, so the opening reads as a gate
    for (const [a, b] of runs) {
      if (a - z0 > 1) {
        mesh(new THREE.BoxGeometry(2.6, 4.2, 1.4), std("floodgate tower", 0x8f8c86), x, 2.1, a - 0.7, { cast: true });
        ctx.addBlocker(x, a - 0.7, 1.4);
      }
      if (z1 - b > 1) {
        mesh(new THREE.BoxGeometry(2.6, 4.2, 1.4), std("floodgate tower", 0x8f8c86), x, 2.1, b + 0.7, { cast: true });
        ctx.addBlocker(x, b + 0.7, 1.4);
      }
    }
    // the promenade on the city side of it, and the road that runs along the top
    const walk = std("levee promenade", 0x9c9484, { roughness: 0.95 });
    mesh(new THREE.BoxGeometry(6, 0.1, z1 - z0), walk, x + 4, 0.05, (z0 + z1) / 2, { cast: false });
    for (let z = z0 + 6; z < z1; z += 44) {
      ctx.addLitSpot({ x: x + 6.5, y: 5, z, warm: 0xffd9a0, power: 80, range: 20, pole: true });
    }
    // the rail spur out on the flood side, and two warehouses against it
    const rx = LEVEE.railX;
    for (const off of [-0.72, 0.72]) mesh(new THREE.BoxGeometry(0.12, 0.16, z1 - z0 - 20), railSteel(), rx + off, 0.12, (z0 + z1) / 2, { cast: false });
    for (let z = z0 + 10; z < z1 - 10; z += 3) mesh(new THREE.BoxGeometry(3.2, 0.14, 0.24), std("rail sleeper", 0x4a4238), rx, 0.07, z, { cast: false });
    for (const [wz, ww] of [[240, 26], [300, 26], [372, 20]]) {
      mesh(new THREE.BoxGeometry(16, 9, ww), std("west bank warehouse", 0x4e5258, { metalness: 0.4, roughness: 0.8 }), rx - 12, 4.5, wz, { cast: true });
      mesh(new THREE.BoxGeometry(17, 0.7, ww + 1), std("warehouse roof", 0x2a2e33), rx - 12, 9.3, wz);
      blockBlocker(rx - 12, wz, 8);
    }
    ctx.makeFence?.(x - 3, z0 + 4, x - 3, z1 - 4);
  }

  const railSteel = () => std("rail steel", 0x6a6258, { metalness: 0.6, roughness: 0.7 });

  /**
   * THE SEAM — the river edge, and the last hole in the middle of the map.
   *
   * 142 m by 64 m of ground that sat between two cities and belonged to neither,
   * because a forest keepout ended at z 128 and a grid began at z 196. It is
   * built as the working frontage both of them grew out of rather than as more
   * city: a canal, a rail spur, two service roads, warehouses with loading
   * docks, chain-link, a fuel tank and a water tower. Low, wide and fenced is
   * what is actually between a downtown and a suburb, and it is why the two
   * grids do not simply run into each other.
   */
  function riverEdge() {
    const { x0, x1, z0, z1 } = SEAM;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = x1 - x0, d = z1 - z0;
    const ground = std("river edge hardstanding", 0x585650, { roughness: 0.97 });
    const conc = ctx.surface("concrete", 1024).material(1, { color: 0x8f8a80 });
    const asphalt = ctx.surface("asphalt", 1024);

    // the hardstanding the whole strip is made of, so it is not a lawn
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, d), conc);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, 0.02, cz);
    pad.receiveShadow = true;
    scene.add(pad);

    // Two service roads across the strip, and the rail along the south edge.
    //
    // The cross-section is the whole design of a 64 m strip and it has to be
    // laid out, not sprinkled: canal, road, sheds, road, sheds. The first version
    // of this put a second row of sheds at z 152 on a strip whose north road is
    // at 150, which is a warehouse with a road through it — and the district's
    // own lane list then reported nine of them as blockers in a carriageway.
    const ROAD_A = z0 + 18, ROAD_B = z1 - 18;      // 150 and 178
    const road = (z) => {
      const m = asphalt.material(1);
      for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) t.repeat.set(Math.max(1, w / 9), 1);
      plane(w, 9, m, cx, 0.04, z);
      for (let x = x0 + 8; x < x1 - 6; x += 40) {
        ctx.addLitSpot({ x, y: 5, z: z - 5.6, warm: 0xffd9a0, power: 80, range: 20, pole: true });
      }
    };
    road(ROAD_A);
    road(ROAD_B);
    // and the north–south link between them, so it is a place and not a corridor.
    // It goes at the EAST end: the sheds are in the western two thirds, and a
    // link road laid at the middle of them runs a carriageway straight through a
    // warehouse, which is the kind of thing a district's own lane list then
    // reports as a blocker in a road for ever.
    const linkX = x1 - 24;
    plane(9, d - 30, asphalt.material(1), linkX, 0.045, cz);
    for (let z = z0 + 24; z < z1 - 26; z += 40) {
      ctx.addLitSpot({ x: linkX + 5.6, y: 5, z, warm: 0xffd9a0, power: 70, range: 18, pole: true });
    }

    // the canal: 9 m of black water with a railing down both banks, which is the
    // one piece of this strip that has to be water to read as a river city. It
    // stops short of the west end with a head wall, because Parish Highway 9
    // comes through there and a canal that runs under a highway is a canal
    // nobody built.
    const canalZ = z0 + 7;
    const canalX0 = x0 + 26;
    const canalW = x1 - 10 - canalX0;
    const water = new THREE.MeshPhysicalMaterial({
      color: 0x0d1a1c, roughness: 0.14, metalness: 0, envMapIntensity: 0.5, name: "canal water",
    });
    water.userData.gtbRealized = true;
    plane(canalW, 9, water, canalX0 + canalW / 2, 0.03, canalZ);
    const bank = std("canal bank", 0x6f6a60, { roughness: 0.95 });
    for (const off of [-5, 5]) {
      mesh(new THREE.BoxGeometry(canalW, 0.7, 1.4), bank, canalX0 + canalW / 2, 0.35, canalZ + off, { cast: false });
    }
    // the head wall, where the canal stops
    mesh(new THREE.BoxGeometry(1.6, 1.2, 11), bank, canalX0 - 0.8, 0.6, canalZ, { cast: true });
    ctx.addBlocker(canalX0 - 0.8, canalZ, 1);
    const iron = std("wrought iron railing", 0x1c1f22, { metalness: 0.6, roughness: 0.5 });
    for (const off of [-5.6, 5.6]) {
      mesh(new THREE.BoxGeometry(canalW, 0.08, 0.08), iron, canalX0 + canalW / 2, 1.0, canalZ + off, { cast: false });
      for (let x = canalX0; x < canalX0 + canalW; x += 2.5) {
        mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), iron, x, 0.75, canalZ + off, { cast: false });
      }
      for (let x = canalX0; x < canalX0 + canalW; x += 3) {
        // …and not where the highway crosses either
        if (onHwy(x, canalZ + off, 6)) continue;
        ctx.addBlocker(x, canalZ + off, 0.8);
      }
    }

    // the rail, running east–west along the south edge and turning north up the
    // levee, so the two are one line
    const railZ = z1 - 8;
    for (const off of [-0.72, 0.72]) mesh(new THREE.BoxGeometry(w + 30, 0.16, 0.12), railSteel(), cx - 10, 0.12, railZ + off, { cast: false });
    for (let x = x0 - 24; x < x1; x += 3) mesh(new THREE.BoxGeometry(0.24, 0.14, 3.2), std("rail sleeper", 0x4a4238), x, 0.07, railZ, { cast: false });

    // warehouses: long, low, corrugated, with a dock and a canopy on the street.
    // Two rows, each facing its own road, with a 3 m apron between the shed line
    // and the carriageway so the dock has somewhere to be.
    const ROW1 = ROAD_A + 14, ROW2 = ROAD_B + 11.5;        // 164 and 189.5
    const sheds = [
      [-274, ROW1, 34, 14, -1], [-242, ROW1, 26, 14, -1], [-212, ROW1, 30, 14, -1],
      [-275, ROW2, 30, 9, 1], [-240, ROW2, 26, 9, 1], [-206, ROW2, 30, 9, 1],
    ];
    for (let i = 0; i < sheds.length; i++) {
      const [sx, sz, sw, sd, face] = sheds[i];       // face -1 docks north, +1 south
      const h = 7 + (i % 3) * 2.5;
      const tint = [0x54585e, 0x4e5258, 0x5a5348][i % 3];
      mesh(new THREE.BoxGeometry(sw, h, sd), std("river warehouse", tint, { metalness: 0.4, roughness: 0.82 }), sx, h / 2, sz, { cast: true });
      // the shallow-pitch roof: two slopes, which is the silhouette that says
      // "warehouse" from a kilometre away and a flat slab does not
      for (const s of [-1, 1]) {
        const pitch = mesh(new THREE.BoxGeometry(sw + 0.8, 0.3, sd / 2 + 0.4), std("warehouse roof", 0x2a2e33), sx, h + 0.7, sz + s * sd / 4, { cast: true });
        pitch.rotation.x = s * 0.09;
      }
      // the dock: a raised platform, a canopy and a roller door, on the road side
      const dockZ = sz + face * (sd / 2 + 1.6);
      mesh(new THREE.BoxGeometry(sw * 0.5, 1.1, 3.2), std("loading dock", 0x8a857c), sx, 0.55, dockZ, { cast: true });
      mesh(new THREE.BoxGeometry(sw * 0.52, 0.25, 3.6), std("dock canopy", 0x3a3f45), sx, 3.4, dockZ, { cast: true });
      mesh(new THREE.BoxGeometry(4.2, 3.6, 0.3), std("roller door", 0x6a6f74), sx, 1.8, dockZ + face * 1.5, { cast: false });
      // One blocker per structural bay rather than one circle inscribed in the
      // whole shed. The circle is the over-reach `blockBlocker` exists to undo:
      // a 26 x 20 m shed has an inscribed radius of 9 m, which reaches 9 m from
      // the middle of a building that is only 10 m deep, and it put nine of these
      // warehouses into the district's own lanes.
      const bays = Math.max(2, Math.round(sw / 11));
      for (let k = 0; k < bays; k++) {
        const bx2 = sx - sw / 2 + (sw / bays) * (k + 0.5);
        blockBlocker(bx2, sz, Math.min(sw / bays / 2 - 0.6, sd / 2 - 0.6));
      }
      // …and the yard is BESIDE the dock, not in front of it: in front is the
      // carriageway, and a container parked in a lane is the same bug again.
      for (const s of [-1, 1]) {
        if (hashf(sx + s, sz, 71 + i) < 0.4) continue;
        const cx2 = sx + s * (sw / 2 + 3.4);
        if (cx2 < x0 + 3 || cx2 > x1 - 3) continue;
        mesh(new THREE.BoxGeometry(6.1, 2.6, 2.44),
          std("shipping container", [0x2f5a6a, 0x6a3a2f, 0x3a5a3a, 0x6a5a2f][(i + (s > 0 ? 1 : 0)) % 4]),
          cx2, 1.3, dockZ, { cast: true, ry: Math.PI / 2 });
        blockBlocker(cx2, dockZ, 1.4);
      }
      if (ctx.makePallet) { ctx.makePallet(sx - sw * 0.3, dockZ, 0); ctx.makePallet(sx - sw * 0.3, dockZ + 1.2, 0); }
      if (ctx.makeFence) ctx.makeFence(sx - sw / 2 - 1, dockZ + face * 3, sx + sw / 2 + 1, dockZ + face * 3);
      pois.push({ x: sx, z: dockZ, r: 7, label: "loading dock" });
    }

    // a fuel tank and a water tower: the two things a working edge always has,
    // and the two shapes that break the roofline. They sit in the gap between the
    // two roads, which is the only part of the cross-section with nothing in it.
    const TANK_X = linkX - 26;
    mesh(new THREE.CylinderGeometry(5, 5, 9, 20), std("fuel tank", 0xb8bdc2, { metalness: 0.5, roughness: 0.5 }), TANK_X, 4.5, cz + 2, { cast: true });
    mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.6, 20), std("tank top", 0x8f959b), TANK_X, 9.3, cz + 2, { cast: false });
    blockBlocker(TANK_X, cz + 2, 5.2);
    for (const [lx, lz] of [[TANK_X, cz - 4], [TANK_X + 5, cz + 7]]) {
      mesh(new THREE.BoxGeometry(0.6, 6, 0.6), std("water tower leg", 0x5a5f64), lx, 3, lz);
      ctx.addBlocker(lx, lz, 0.5);
    }
    mesh(new THREE.CylinderGeometry(3.4, 3.4, 5, 14), std("water tower", 0x9aa0a6, { metalness: 0.4, roughness: 0.6 }), TANK_X + 2.5, 8.5, cz + 1.5, { cast: true });
    mesh(new THREE.ConeGeometry(3.6, 1.6, 14), std("water tower cap", 0x6a7076), TANK_X + 2.5, 11.8, cz + 1.5, { cast: true });

    // ---------------------------------------------------------------- the east end
    //
    // The shed rows above stop at x -206, and the eastern end of this strip was
    // surveyed at 4.4% covered by two structures, against 32% and 38% for the two
    // western thirds. It is the worst-covered part of the seam, and it is the
    // part you meet first — the strip is entered from the causeway at its north
    // edge and read westward, so a bare eastern end is the first thing on screen.
    //
    // Two things constrain the layout here and both were found by measuring, not
    // by looking, which is the only reason this section is written down at all:
    //
    //   1. The link road (linkX = x1 - 24 = -180) runs the full 64 m of the
    //      strip's depth. With its 9 m carriageway and a verge either side it
    //      takes an 18 m bite out of a 44 m width, which leaves two runs of
    //      roughly 11 m and 14 m. Units 9..19 m wide therefore do not fit on
    //      both sides — a first attempt at this used those widths, built a single
    //      unit, and left the rest of the band bare while looking like it had
    //      worked. The units are 5..9 m here, which is the width a chandlery,
    //      a tackle shop and a sign writer actually trade at.
    //   2. The cross-section is NOT free space. ROAD_A is at z 150, ROAD_B at
    //      z 178 and the rail runs at z 188, and the canal crosses the north
    //      edge at z 139. The band therefore goes in TWO z-slots either side of
    //      ROAD_B — a frontage slot on its north apron and a backland slot on
    //      its south side, clear of both carriageways and of the rail — rather
    //      than one row of tall boxes parked wherever there was room.
    //
    // It is low-rise deliberately: a four-storey office block here would
    // out-rank the water tower, and the water tower only earns its silhouette by
    // being the tallest thing on the seam.
    {
      const linkClear = 9;                       // 9 m carriageway + verge either side
      // -196, not -200: the ROW1 shed at x -212 is 30 m wide and ends at -197, and
      // the first unit and the car park started three metres inside it.
      const E0 = -196, E1 = x1 - 1;              // -196 .. -157
      const inLink = (x, half = 0) => Math.abs(x - linkX) < linkClear + half;
      // The two x runs, either side of the link road. Declared as BOUNDS, not
      // derived while walking: a single loop that steps over the keep-out has
      // two ways to fail to advance — step by the keep-out edge and the next
      // unit starts inside the keep-out and the build hangs with no error; step
      // by the keep-out plus a half-width and the walk overshoots the far side
      // entirely. Bounded runs cannot do either.
      //
      // The WEST run is bounded at -191, not at E0, because the ROW2 shed at
      // z 185..194 already reaches x -191 and this backland sits in that same
      // z slot. Letting the backland start at -200 put nine metres of workshop
      // inside a warehouse that is already there — the two meshes interpenetrate
      // and the seam's own survey reports the overlap as one fatter building, so
      // the collision is invisible in every number and only shows up on foot.
      // E0 bounds the SHOPS, which are 15 m north of that shed; BACK0 bounds the
      // backland, which is not.
      const RUNS = [[E0, linkX - linkClear], [linkX + linkClear, E1]];
      const BACK_RUNS = [[-191, linkX - linkClear], [linkX + linkClear, E1]];

      const lotMat = std("river edge lot", 0x4e4b46, { roughness: 0.97 });
      const lineMat = std("parking bay line", 0xcfc9b8, { roughness: 0.9 });
      const carCols = [0x8a2f2f, 0x2f4a8a, 0xb0b0b4, 0x3a5a3a, 0xd8d4c8, 0x6a6a70];
      const parkedCar = (x, z, ry, col, seed) => {
        const c = mesh(new THREE.BoxGeometry(1.85, 1.4, 4.3),
          std("parked car", carCols[col % carCols.length]), x, 0.74, z, { cast: true, ry });
        c.userData.gtbRealized = true;
        return c;
      };

      // ---- the frontage slot: north apron of ROAD_B, shops facing the road.
      //
      // z is derived from ROAD_B rather than written as a literal, for the reason
      // the rest of this function does it — if the seam moves, a hard-coded z
      // puts the shopfronts in the middle of the carriageway.
      const SHOP_Z = ROAD_B - 8.5;               // 169.5: units sit on the apron,
                                                // glazing 4 m south of ROAD_B's kerb
      const SIGNS = [
        ["BAYOU", "MARINE", "#ff4fb3", "#1a0a12"],
        ["TACKLE", "SHOP", "#4fd8ff", "#081a20"],
        ["THE TIDE", "LOUNGE", "#ffd24f", "#1a1408"],
        ["PILOT", "HOUSE", "#7dff9a", "#081a0c"],
        ["COLD", "BEER", "#ff6a3d", "#1a0a06"],
        ["DOCKSIDE", "GROCERY", "#8fd8ff", "#081018"],
      ];
      let unit = 0;
      for (const [rx0, rx1] of RUNS) {
        let ux = rx0;
        while (ux < rx1 - 4) {
          // 5..9 m: the width a strip of this kind actually trades at, and the
          // width that fits the two runs the link road leaves behind.
          const uw = 5 + Math.floor(hashf(ux, SHOP_Z, 301) * 5);   // 5..9
          if (ux + uw > rx1) break;                 // a clipped unit is not a unit
          const v = hashf(ux, SHOP_Z, 307);
          const twoStorey = v < 0.3;
          const h = twoStorey ? 7.6 : 4.2;
          const depth = 8;
          const cxu = ux + uw / 2;
          // The unit stands NORTH of SHOP_Z and faces south, onto its apron and
          // ROAD_B. It was built on the other side (zc = SHOP_Z + depth / 2) with
          // every front detail on its north face: the strip stood back to front,
          // its rear half in River Edge 178's westbound lane, and the apron's own
          // parked cars and lamp poles inside the shops.
          const zc = SHOP_Z - depth / 2;
          const front = zc + depth / 2;            // = SHOP_Z, the shopfront line
          mesh(new THREE.BoxGeometry(uw, h, depth),
            std("river frontage render", [0xa89880, 0x8f8a7c, 0x9a8b84, 0x7d8590][unit % 4], { roughness: 0.93 }),
            cxu, h / 2, zc, { cast: true });
          // A dark shopfront band at walking height, and a canopy over it. At
          // eye level a city is shopfront all the way down, and this 1.5 m band
          // is the cheapest thing in the file that stops a row of boxes reading
          // as a row of boxes.
          mesh(new THREE.BoxGeometry(uw - 0.5, 1.5, 0.3),
            std("shopfront glazing", 0x141a20, { metalness: 0.35, roughness: 0.25 }),
            cxu, 1.05, front + 0.1, { cast: false });
          mesh(new THREE.BoxGeometry(uw - 0.3, 0.2, 1.8), std("shop canopy", 0x3a3f45), cxu, 2.9, front + 0.8, { cast: true });
          // parapet, so the top edge is finished from the causeway above
          mesh(new THREE.BoxGeometry(uw + 0.2, 0.6, depth + 0.2), std("frontage parapet", 0x6e6a62), cxu, h + 0.3, zc, { cast: true });
          if (hashf(ux, SHOP_Z, 311) < 0.45) {
            mesh(new THREE.BoxGeometry(1.8, 1.1, 1.6), std("roof plant", 0x8d9298, { metalness: 0.4, roughness: 0.6 }), cxu, h + 1.15, zc, { cast: true });
          }
          // One blocker per unit. The sheds need one per structural bay because
          // a 30 m shed is several buildings; a 7 m shopfront is one wall to a
          // walker, so the inscribed circle here is not an over-reach.
          blockBlocker(cxu, zc, Math.min(uw / 2 - 0.3, depth / 2 - 0.3));

          if (v > 0.2) {
            const sgn = SIGNS[Math.floor(hashf(ux, SHOP_Z, 317) * SIGNS.length) % SIGNS.length];
            // The sign is 1.2 m narrower than the unit, not equal to it: neon
            // that runs the full width of every unit in a row reads as one long
            // sign that has been stretched over five shops.
            const sw = Math.min(uw - 0.8, 4.4);
            neonSign(sgn[0], sgn[2], sgn[3], sw, 1.0, cxu, 3.5, front + 0.25, 0, 0);
            if (twoStorey) neonSign(sgn[1], "#ffffff", sgn[3], sw * 0.8, 0.7, cxu, 4.6, front + 0.25, 0, 0);
          } else {
            // Not every unit on a strip is lit. An unbroken line of neon is a
            // sign the band was generated, so the unlit ones get an awning.
            mesh(new THREE.BoxGeometry(uw - 0.6, 0.1, 1.2), std("awning canvas", [0x6a4a3a, 0x4a5a4a, 0x5a4a5a][unit % 3]), cxu, 2.6, front + 0.6, { cast: true });
          }
          // A pole sign every third unit or so. This is the part that does the
          // work the brief asked for: the band has to be legible from the road
          // and from the causeway above it, not only on foot, and a pole sign is
          // the only thing on a low unit that clears the canopy.
          if (unit % 3 === 1) {
            const px = ux + 0.8;
            mesh(new THREE.BoxGeometry(0.28, 8.2, 0.28), std("pole sign post", 0x4a4e54, { metalness: 0.5 }), px, 4.1, front + 1.6, { cast: true });
            ctx.addBlocker(px, front + 1.6, 0.35);
            ctx.makeBillboard(px, 9.2, front + 1.6, 0,
              ["BAYOU MARINE", "TACKLE · BAIT · ICE", "THE TIDE LOUNGE", "PILOT HOUSE", "COLD BEER", "DOCKSIDE GROCERY"][unit % 6],
              ["CHANDLERY", "OPEN LATE", "LIVE BAIT", "DRIVE IN", "ICE · BAIT", "RIVER ROAD"][unit % 6],
              "RIVER ROAD");
          }
          pois.push({ x: cxu, z: front + 1, r: 4, label: "river frontage" });
          ux += uw;
          unit++;
        }
      }

      // ---- the car parks, on the same apron, in the gaps the link road leaves.
      //
      // 5.4 m deep is one row of stalls. Two rows would be a better car park and
      // would push the backland out of the strip, so the backland takes what is
      // left and this stays a single row — which is also what a small port-edge
      // lot actually is.
      for (const [rx0, rx1] of RUNS) {
        const span = rx1 - rx0;
        if (span < 7) continue;
        const bays = Math.max(1, Math.floor(span / 2.6));
        const z = SHOP_Z - 8 - 3.2;                // behind the units (8 m deep), clear
                                                // of ROAD_A's kerb at 154.5
        mesh(new THREE.BoxGeometry(span, 0.06, 5.4), lotMat, (rx0 + rx1) / 2, 0.035, z, { cast: false });
        const step = span / bays;
        for (let i = 0; i <= bays; i++) {
          mesh(new THREE.BoxGeometry(0.12, 0.02, 5), lineMat, rx0 + step * i, 0.07, z, { cast: false });
        }
        for (let i = 0; i < bays; i++) {
          if (hashf(rx0 + step * (i + 0.5), z, 91) < 0.3) continue;
          parkedCar(rx0 + step * (i + 0.5), z, Math.PI / 2,
            Math.floor(hashf(rx0 + step * i, z, 97) * carCols.length));
        }
      }

      // ---- the backland slot: SOUTH of ROAD_B, clear of the carriageway and of
      // the rail at z1 - 8 = 188. The ground behind a chandlery is a workshop and
      // a store, and putting it on the far side of the road rather than behind
      // the shop is what lets the shop row face its own road with nothing behind
      // it — which is how a working edge is actually laid out.
      {
        const BZ = ROAD_B + 8.5;                   // 186.5, between the road and the rail
        const bh = 5.2;
        let b = 0;
        for (const [rx0, rx1] of BACK_RUNS) {
          let bx = rx0;
          while (bx < rx1 - 4) {
            const bw = 7 + Math.floor(hashf(bx, BZ, 331) * 3);   // 7..9
            if (bx + bw > rx1) break;
            mesh(new THREE.BoxGeometry(bw, bh, 6), std("backland workshop", [0x5a5f62, 0x4f5552][b % 2], { metalness: 0.35, roughness: 0.85 }), bx + bw / 2, bh / 2, BZ, { cast: true });
            mesh(new THREE.BoxGeometry(bw + 0.3, 0.28, 6.3), std("workshop roof", 0x2b2f33), bx + bw / 2, bh + 0.14, BZ, { cast: true });
            mesh(new THREE.BoxGeometry(2.6, 2.8, 0.3), std("roller door", 0x6a6f74), bx + bw / 2, 1.4, BZ - 3.1, { cast: false });
            if (ctx.makePallet) { ctx.makePallet(bx + 0.8, BZ - 4.2, 0); ctx.makePallet(bx + 0.8, BZ - 3.2, 0); }
            if (ctx.makeBarrel && hashf(bx, BZ, 337) < 0.55) ctx.makeBarrel(bx + bw - 0.9, BZ - 4);
            blockBlocker(bx + bw / 2, BZ, Math.min(bw / 2 - 0.4, 3));
            bx += bw;
            b++;
          }
        }
      }

      // ---- lighting. The shed rows are lit off the two roads already; this end
      // had no pole at all, which at night is exactly why an otherwise working
      // edge reads as a gap. Poles go on the apron, never in a carriageway and
      // never in the link road.
      for (const z of [SHOP_Z - 12, SHOP_Z + 3]) {
        for (let x = E0 + 5; x < E1 - 3; x += 17) {
          if (inLink(x, 1.5)) continue;
          ctx.addLitSpot({ x, y: 5.4, z, warm: 0xffd9a0, power: 80, range: 20, pole: true });
        }
      }

      // Parked cars along the ROAD_B apron, nose to the kerb. Six metres of depth
      // the strip was not using, and the one thing that makes a road read as a
      // place you stop at rather than a road you pass.
      for (let x = E0 + 4; x < E1 - 3; x += 6.5) {
        if (inLink(x, 3.2) || hashf(x, ROAD_B, 349) < 0.42) continue;
        parkedCar(x, ROAD_B - 6.6, Math.PI / 2, Math.floor(hashf(x, ROAD_B, 353) * carCols.length));
      }
    }
    // the perimeter fence, and a gate where the service road leaves east
    if (ctx.makeFence) {
      ctx.makeFence(x0 + 1, z0 + 1, x1 - 1, z0 + 1);
      ctx.makeFence(x0 + 1, z1 - 1, x1 - 1, z1 - 1);
      ctx.makeFence(x0 + 1, z0 + 1, x0 + 1, z1 - 1);
    }
    // …and the ground has to read as part of the city from the causeway above it
    pois.push({ x: cx, z: z0 + 18, r: 8, label: "river edge" });
    pois.push({ x: cx, z: z1 - 20, r: 8 });
  }

  // ---------------------------------------------------------------- downtown
  const windowTex = [0, 1, 2].map((v) => canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = ["#1b2530", "#22303a", "#1d2228"][v]; x.fillRect(0, 0, w, h);
    const rnd = () => Math.random();
    for (let cy = 0; cy < 4; cy++) {
      for (let cx = 0; cx < 4; cx++) {
        const on = rnd() < [0.45, 0.3, 0.6][v];
        x.fillStyle = on ? ["#ffd89a", "#bfe6ff", "#fff1c8"][v] : "#0c1218";
        x.fillRect(cx * 32 + 5, cy * 32 + 7, 22, 18);
      }
    }
  }));
  const towerMats = windowTex.map((t, i) => {
    const m = new THREE.MeshStandardMaterial({
      name: "glass tower facade", map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9,
      roughness: 0.3, metalness: 0.4,
    });
    m.userData.gtbRealized = true;          // keep the lit windows as authored
    return m;
  });
  function tower(x, z, w, d, h, v) {
    mesh(tiledBox(w, h, d, 4, 4), towerMats[v % towerMats.length], x, h / 2, z);
    mesh(new THREE.BoxGeometry(w + 0.6, 1.2, d + 0.6), std("concrete roof", 0x3a3d40), x, h + 0.6, z);
    mesh(new THREE.SphereGeometry(0.35, 8, 6), basic(new THREE.Color(0xff2a1a).multiplyScalar(3)), x, h + 2, z, { cast: false });
    for (const [bx, bz] of [[-w / 4, -d / 4], [w / 4, -d / 4], [-w / 4, d / 4], [w / 4, d / 4]]) ctx.addBlocker(x + bx, z + bz, Math.min(w, d) / 3);
    occluders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h + 1.2, minZ: z - d / 2, maxZ: z + d / 2 });
  }
  /**
   * The civic end: the part of the city east of midtown.
   *
   * It exists because the city grew and something has to be on the new ground.
   * This is where a metropolis puts the things that need their own space — a
   * park, a campus, a hospital, a big box of a car park — because the blocks out
   * here are the ones not already spoken for, and because the skyline is far
   * enough away that a low building still reads against it.
   *
   * The named set pieces go in `landmarks.js`, which claims blocks before any of
   * this runs; what is left here is the ordinary civic fabric around them.
   */
  function civicEnd(bl) {
    for (const b of bl) {
      if (zoneOf(b, ctx.ROAD_X) !== "civic") continue;
      const g = buildingGroup(b);
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      const roll = hashf(b.cx, b.cz, 21);
      if (roll < 0.22) {
        P.park(g, b.cx, b.cz, w - 5, d - 5, Math.floor(b.cx));            // a neighborhood green
        if (hashf(b.cx, b.cz, 22) < 0.5) P.fountain(g, b.cx, b.cz, 4.5);
        P.statue(g, b.x0 + 6, b.z1 - 6, "bronze", 3);
      } else if (roll < 0.40) {
        // a hospital or a school: a long low block with a courtyard behind
        P.midrise(g, b.cx, b.cz - d * 0.2, w - 6, d * 0.5, 22, Math.floor(b.cx));
        P.park(g, b.cx, b.cz + d * 0.28, w - 14, d * 0.3, Math.floor(b.cz));
        P.statue(g, b.cx, b.cz - d * 0.2 - d * 0.25 - 2, "soldier", 4);
      } else if (roll < 0.58) {
        // a surface car park, which every city has and nobody draws
        //
        // This line called `put`, which is not a function in this file — it was
        // never declared and nothing named put exists on ctx either, so the
        // moment a block reached this branch the whole build died with
        // "put is not defined". It stayed hidden because until now no civic
        // block ever rolled a value into 0.40..0.58 in the two rows below the
        // old CITY.minZ: the branch was dead code that had never been run.
        // mesh() with { parent: g } is the local equivalent and is what every
        // other line in this builder uses.
        mesh(new THREE.BoxGeometry(w - 6, 0.1, d - 6), std(0x4a4a4e, "car park surface", { roughness: 0.98 }), b.cx, 0.05, b.cz, { cast: false, parent: g });
        for (let i = 0; i < 14; i++) {
          const px = b.x0 + 4 + (i % 7) * ((w - 8) / 7), pz = b.cz + (i < 7 ? -d / 5 : d / 5);
          mesh(new THREE.BoxGeometry(1.9, 1.35, 4.2), std([0x8a2f2f, 0x2f4a8a, 0xb0b0b4, 0x3a5a3a, 0xd8d4c8][Math.floor(hashf(px, pz, 7) * 5)], "parked car"), px, 0.78, pz, { cast: false });
        }
        // 16 m deep, its front half a metre inside the block. At b.cz - 0.3d it stood
        // 0.8 m OUT of every 26 m block, on the kerb of the street in front.
        P.garage(g, b.cx, b.z0 + 8.5, Math.min(w - 10, 40), 16, 5, Math.floor(b.cx));
      } else {
        // a college of the ordinary sort: a quad of walk-ups round a lawn
        const n = Math.max(1, Math.floor(w / 16));
        for (let i = 0; i < n; i++) {
          const bw = w / n;
          P.midrise(g, b.x0 + bw * (i + 0.5), b.z0 + 8, bw - 4, 14, 15 + ((i * 7) % 9), i);
          P.midrise(g, b.x0 + bw * (i + 0.5), b.z1 - 8, bw - 4, 14, 15 + ((i * 11) % 9), i + 5);
        }
        P.park(g, b.cx, b.cz, w - 10, d - 24, Math.floor(b.cx + b.cz));
        P.bandstand(g, b.cx, b.cz);
        pois.push({ x: b.cx, z: b.cz, r: 8, label: "campus green" });
      }
      pois.push({ x: b.cx, z: b.z0 - 4, r: 6 });
    }
  }

  /**
   * The gateway: the west side of the arrival band, z 130..210, x < the
   * boulevard.
   *
   * This band is the first thing a player sees driving in over the bridge, and
   * until now the west half of it was the emptiest part of the approach — the
   * Quarter and the West Bank are deliberately LOW, and both builders say so in
   * their own comments. That is correct for their districts and wrong here,
   * because a low-rise district on the approach reads as the city stopping short
   * of you and starting again once you are through it.
   *
   * The fix is not to make the Quarter tall. A French Quarter with 40 m towers
   * in it stops being a French Quarter, and the West Bank's whole reason for
   * existing is that you can see the CBD from the water. So the gateway is a
   * separate district that claims these blocks by position, and the two
   * low-rise districts keep every block north of z 210.
   *
   * The height gradient is the point. Tallest at the boulevard end (x near
   * ROAD_X), stepping down toward the river, so the towers are the first thing
   * on the west side of the skyline and they get out of the way as you pass
   * them. That is how a real waterfront district steps down, and it is what
   * stops the towers being a wall you drive past.
   */
  function gatewayDistrict(bl) {
    let v = 0;
    for (const b of bl) {
      const bw = b.x1 - b.x0, bd = b.z1 - b.z0;
      // 0 at the water (x = CITY.minX) to 1 at the boulevard, on a curve so the
      // tall end is a tight cluster rather than a half-length of towers
      const toRoad = Math.max(0, Math.min(1, (b.cx - CITY.minX) / (ctx.ROAD_X - CITY.minX)));
      const near = toRoad * toRoad;
      const g = buildingGroup(b);

      if (near > 0.62) {
        // A proper tower: this is the district the band needed. Heights run
        // 55..120 m, lower than the CBD on purpose — the CBD is downtown, this
        // is the edge of it, and two districts of identical 200 m towers would
        // read as one undifferentiated mass.
        const h = 55 + near * 46 + ((v * 29) % 22);
        const w = bw * 0.42, d = bd - 5;
        if (bw > 30) {
          tower(b.cx - bw / 4.2, b.cz, w, d, h, v++);
          tower(b.cx + bw / 4.2, b.cz, w, d, h * 0.72 + ((v * 17) % 20), v++);
        } else {
          tower(b.cx, b.cz, bw - 4, d, h, v++);
        }
        // a podium along the street, which is what makes a tower look like it
        // belongs to a street rather than having been dropped on a plot
        mesh(new THREE.BoxGeometry(bw - 3, 9, 5.5), std("gateway podium", 0x6f7176, { metalness: 0.25, roughness: 0.6 }), b.cx, 4.5, b.z1 - 3.2, { parent: g });
        // and a glazed shopfront strip on it, so the base is lit at night
        for (let x = b.x0 + 4; x < b.x1 - 4; x += 6) {
          mesh(new THREE.BoxGeometry(4, 3.2, 0.3), std("gateway shopfront glass", 0x18242c, { metalness: 0.6, roughness: 0.12 }), x, 3.4, b.z1 - 0.6, { cast: false, parent: g });
          if (Math.floor(hashf(x, b.cz, 3) * 3) === 0) ctx.addLitSpot({ x, y: 2.6, z: b.z1 - 1.4, warm: 0xffe2b0, power: 42, range: 12, pole: false });
        }
      } else if (near > 0.28) {
        // mid-rise: 4-8 storeys, the shoulder of the district. Warehouses and
        // older commercial stock rebuilt in brick, which is what actually sits
        // between a waterfront and a downtown.
        const h = 16 + near * 22 + ((v * 11) % 9);
        for (const [fx, fw] of [[-0.22, 0.46], [0.24, 0.44]]) {
          const hh = fx < 0 ? h : h * 0.8;
          mesh(new THREE.BoxGeometry(bw * fw, hh, bd - 6), std("gateway midrise", [0x8a6a52, 0x7d7266, 0x93795e][(v + (fx > 0 ? 1 : 0)) % 3], { roughness: 0.88 }), b.cx + bw * fx, hh / 2, b.cz, { parent: g });
          ctx.addBlocker(b.cx + bw * fx, b.cz, Math.min(bw * fw, bd - 6) / 2.4);
          occluders.push({ minX: b.cx + bw * fx - bw * fw / 2, maxX: b.cx + bw * fx + bw * fw / 2, minY: 0, maxY: hh, minZ: b.cz - (bd - 6) / 2, maxZ: b.cz + (bd - 6) / 2 });
        }
        // a roof line of plant and vents, so the mid-rise is not a bare box from
        // the approach
        for (let i = 0; i < 3; i++) {
          const px = b.cx - bw * 0.2 + i * bw * 0.2;
          mesh(new THREE.BoxGeometry(2.4, 1.6, 2.0), std("gateway roof plant", 0x4c4e52), px, h + 0.8, b.cz + 2, { parent: g });
        }
      } else {
        // The low end, against the water: West Bank working stock, kept low on
        // purpose so the towers are visible behind it. This is deliberately the
        // same vocabulary as the West Bank builder so the district reads as one
        // continuous waterfront rather than two things meeting.
        if (Math.floor(hashf(b.cx, b.cz, 61) * 3) === 0) {
          bankHouse(g, b.cx, b.cz - 4, Math.min(bw - 6, 9), 8, 5.5, 1, v);
          bankHouse(g, b.cx + bw * 0.28, b.cz + 4, Math.min(bw * 0.4, 8), 7, 4.5, -1, v + 1);
        } else {
          // a low warehouse: long, shallow, with a sawtooth roof, which is the
          // silhouette that makes a waterfront read as a waterfront
          const h = 7 + Math.floor(hashf(b.cx, b.cz, 62) * 4);
          mesh(new THREE.BoxGeometry(bw - 5, h, bd - 8), std("gateway warehouse brick", 0x6b4a3c, { roughness: 0.9 }), b.cx, h / 2, b.cz, { parent: g });
          mesh(new THREE.BoxGeometry(bw - 4, 0.5, bd - 7), std("gateway warehouse roof", 0x2e2a26), b.cx, h + 0.25, b.cz, { parent: g });
          for (let i = 0; i < 4; i++) {
            mesh(new THREE.BoxGeometry((bw - 6) / 5, 0.9, 2.2), std("gateway sawtooth", 0x565049), b.cx - (bw - 6) / 2 + (i + 0.5) * ((bw - 6) / 5), h + 0.9, b.cz, { parent: g });
          }
          ctx.addBlocker(b.cx, b.cz, Math.min(bw - 5, bd - 8) / 2.4);
          if (ctx.makeFence) ctx.makeFence(b.x0 + 1, b.z0 + 1, b.x1 - 1, b.z0 + 1);
          // Outbuildings in the yard behind. Without these a warehouse block is
          // ONE object on an empty apron, and the yard reads as a car park: the
          // block count in this district fell from 36 structures to 22 when the
          // gateway took these blocks from the Quarter, because `rowhouse` put
          // a separate house on every frontage and a single box does not. Small
          // sheds and a container stack put the density back.
          for (let i = 0; i < 4; i++) {
            const ox = b.cx - (bw - 12) / 2 + (i + 0.5) * ((bw - 12) / 4);
            const oz = b.cz + bd * 0.3 + ((i % 2) ? 2.5 : -1.5);
            if (Math.abs(ox - b.cx) < 4 && Math.abs(oz - b.cz) < 4) continue;   // keep clear of the main mass
            const oh = 2.4 + ((i * 7) % 3) * 0.7;
            mesh(new THREE.BoxGeometry(3.2 + (i % 2) * 1.4, oh, 2.6),
              std("gateway outbuilding", [0x5f5148, 0x6a5b4e, 0x4f5a52][i % 3], { roughness: 0.92 }),
              ox, oh / 2, oz, { parent: g });
            ctx.addBlocker(ox, oz, 1.6);
          }
          // a container stack, because a waterfront with no containers on it is
          // a waterfront that has not been used
          for (let i = 0; i < 3; i++) {
            const ox = b.cx - 6 + i * 2.7, oy = i === 2 ? 2.65 : 1.3;
            mesh(new THREE.BoxGeometry(2.5, 2.6, 6),
              std("gateway container", [0x2f5a6a, 0x6a3a2f, 0x3a5a3a][i % 3]),
              ox, oy, b.z0 + 4, { parent: g });
            ctx.addBlocker(ox, b.z0 + 4, 1.3);
          }
        }
      }
      // every block in the gateway gets a POI on its street corner, so the
      // district is a destination rather than a corridor
      pois.push({ x: b.cx, z: b.z1 - 4, r: 6 });
      v++;
    }
  }

  /** A superblock with nothing claimed on it: kept as open ground, not built over. */
  function grassyReserve(b) {
    const g = buildingGroup(b);
    P.park(g, b.cx, b.cz, b.x1 - b.x0, b.z1 - b.z0, Math.floor(b.cx - b.cz));
    // and a low wall round it, so it reads as reserved ground rather than a hole
    const wall = std(0xb0aa9c, "boundary wall", { roughness: 0.9 });
    for (const [x, z, w, d] of [
      [b.cx, b.z0, b.x1 - b.x0, 0.5], [b.cx, b.z1, b.x1 - b.x0, 0.5],
      [b.x0, b.cz, 0.5, b.z1 - b.z0], [b.x1, b.cz, 0.5, b.z1 - b.z0],
    ]) {
      mesh(new THREE.BoxGeometry(w, 0.9, d), wall, x, 0.45, z);
      ctx.addBlocker(x, z, 0.4);
    }
  }

  /**
   * The central business district, and it is much taller than it was.
   *
   * It used to be 22-72 m of glass on a flat hash, which is a skyline you could
   * walk past anywhere. A CBD reads by CONTRAST — a few genuinely tall towers
   * with low stuff between them, so the eye has something to measure against —
   * so the heights now run from 30 m to 150 m and the tall ones cluster near
   * the boulevard rather than being spread evenly.
   */
  function downtown(bl) {
    let v = 0;
    for (const b of bl) {
      if (zoneOf(b, ctx.ROAD_X) !== "cbd") continue;
      const bw = b.x1 - b.x0, bd = b.z1 - b.z0;
      // the closer to the boulevard, the taller — the classic reason a CBD has
      // a peak rather than a plateau
      const near = 1 - Math.min(1, (b.cx - ctx.ROAD_X) / 320);
      let tall = 30 + near * near * 90 + ((v * 37) % 42);
      // ---------------------------------------------------------------- the
      // arrival district
      //
      // The southern two rows (z 130..210) are where US-167 comes into the city,
      // and they were swamp until the grid reached them. A player driving north
      // sees this band FIRST and the rest of downtown second, so if this band
      // is a thin line of towers the skyline reads as starting late, and the
      // approach — the shot the game opens on — is the weakest part of the city.
      //
      // So the arrival band is given a height AND a density premium: a third
      // tower on the wide plots, and a floor multiplier on all of them. It is
      // also the only place the multiplier is applied, because a premium
      // everywhere is not a premium, it is just a taller city.
      //
      // The floor is on `tall` rather than added to each tower's height so the
      // ordering the `near` term establishes is preserved — the tallest tower
      // in the band is still the one nearest the boulevard, it is just further
      // above the skyline it belongs to.
      const arrival = b.cz < 210;
      if (arrival) tall = tall * 1.22 + 26;
      if (bw > 26) {
        tower(b.cx - bw / 4, b.cz, bw / 2 - 2, bd - 4, tall, v++);
        tower(b.cx + bw / 4, b.cz, bw / 2 - 2, bd - 4, tall * 0.78 + ((v * 23) % 30), v++);
        // A third tower on the widest plots, set back. A CBD block that is two
        // towers is a pair; three is a cluster, and a cluster is what makes a
        // skyline read as a downtown rather than as scattered boxes. Only on
        // plots over 34 m wide, because on a 28 m plot a third tower is a
        // 9 m-wide sliver with two 30 m neighbours leaning on it.
        if (bw > 34) {
          tower(b.cx + (v % 2 ? 1 : -1) * bw * 0.28, b.cz + bd * 0.22,
            bw * 0.22, bd * 0.42, tall * (0.6 + (v % 3) * 0.12), v++);
        }
      } else {
        tower(b.cx, b.cz, bw - 3, bd - 4, tall, v++);
        if (arrival && bd > 30) {
          // on a narrow arrival plot, a second tower goes behind the first
          tower(b.cx + ((v % 2) ? 1 : -1) * bw * 0.2, b.cz + bd * 0.26,
            bw * 0.42, bd * 0.4, tall * (0.55 + (v % 3) * 0.1), v++);
        }
      }
      // a low older building on the rest of the plot, so the block is not one
      // object on a car park
      if (bd > 34) P.midrise(buildingGroup(b), b.cx, b.cz + bd / 2 - 7, bw * 0.5, 11, 12 + ((v * 13) % 10), v);
      pois.push({ x: b.cx, z: b.z0 - 4, r: 6 });
    }
  }

  /**
   * Midtown and the north edge: the middle of the sequence, and the part that
   * was simply missing. Between a low Quarter and a tall CBD there is a hundred
   * blocks of ordinary brick walk-ups, and without them the city is two places
   * with a seam down the middle. This is the fabric that makes it a metropolis.
   */
  function midtown(bl) {
    let v = 0;
    for (const b of bl) {
      if (zoneOf(b, ctx.ROAD_X) !== "midtown") continue;
      const bw = b.x1 - b.x0, bd = b.z1 - b.z0;
      const g = buildingGroup(b);
      if (bw > 30) {
        // two walk-ups with a light court between, and one tower behind
        P.midrise(g, b.cx - bw / 4, b.cz, bw / 2 - 4, bd - 5, 16 + ((v * 11) % 16), v);
        P.midrise(g, b.cx + bw / 4, b.cz, bw / 2 - 4, bd - 5, 14 + ((v * 17) % 18), v);
        if (hashf(b.cx, b.cz, 3) < 0.45) tower(b.cx, b.cz + bd / 2 - 9, Math.min(22, bw * 0.3), 18, 46 + hashf(b.cx, b.cz, 4) * 54, 1, v);
      } else {
        P.midrise(g, b.cx, b.cz, bw - 3, bd - 5, 15 + ((v * 19) % 20), v);
      }
      if (hashf(b.cx, b.cz, 9) < 0.3) P.garage(g, b.cx + bw / 2 - 8, b.cz - bd / 2 + 8, 16, 12, 3, v);
      pois.push({ x: b.cx, z: b.z0 - 4, r: 6 });
      v++;
    }
  }

  /**
   * The Garden District: wide, low Italianate houses behind cast-iron fences, on
   * the biggest plots in the city. It is the direct opposite of the Quarter two
   * blocks away and putting the two side by side is the whole reason to have
   * both.
   */
  function gardenDistrict(bl) {
    for (const b of bl) {
      if (zoneOf(b, ctx.ROAD_X) !== "garden") continue;
      const g = buildingGroup(b);
      const w = b.x1 - b.x0;
      let x = b.x0 + 1, i = 0;
      while (x < b.x1 - 9) {
        const hw = Math.min(b.x1 - 1 - x, 13 + Math.floor(hashf(x, b.cz, 2) * 6));
        if (hw < 10) break;
        P.gothic(g, x + hw / 2, b.z0 + 7, hw, -1, i);
        if (hashf(x, b.cz, 5) < 0.5) P.statue(g, x + hw / 2, b.z0 + 2.4, "bronze", i);   // a street-corner monument
        x += hw + 1.5; i++;
      }
      // the deep back gardens, which is what the district is actually for
      P.park(g, b.cx, b.z1 - 16, w - 6, 20, i);
      pois.push({ x: b.cx, z: b.z0 - 4, r: 6 });
    }
  }

  // ---------------------------------------------------------------- landmarks
  function shops(bl) {
    // the north edge of the city: pawn shops, check cashing, a daiquiri shop
    const signs = [["PAWN", "#ffd23a", "#101010"], ["CHECK CASHING", "#3aff9a", "#0c1410"],
      ["24 HR DAIQUIRI", "#ff4fb3", "#1a0f1a"], ["LIQUOR", "#ff5a3c", "#140a08"]];
    let s = 0;
    for (const b of bl) {
      if (b.cz > 206 || b.cx > 176 || b.x1 - b.x0 < 10) continue;
      // …but the north edge gets a strip of them too, or the edge of the city
      // goes from brick to warehouse with nothing in between
      const w = Math.min(b.x1 - b.x0 - 2, 16);
      mesh(new THREE.BoxGeometry(w, 4.2, 6), std("brick wall", 0x7a4a3a), b.cx, 2.1, b.cz + 1);
      const [t, ink, bg] = signs[s++ % signs.length];
      neonSign(t, ink, bg, Math.min(w - 1, 8), 1.3, b.cx, 4.7, b.cz - 2.2, Math.PI, 0.2);
      ctx.addBlocker(b.cx, b.cz + 1, Math.min(w, 6) / 2);
      if (t === "PAWN" && ctx.addService) ctx.addService({ kind: "gun", name: "OrleaRouge Pawn & Guns", x: b.cx, z: b.cz - 3.8, face: Math.PI });
      if (t === "24 HR DAIQUIRI") {
        // "Police cruisers parked outside a twenty-four-hour daiquiri shop."
        //
        // The guard is on `clone`, not on `proto`. `getSheriffProto` returns a
        // live Object3D in the game but a bare {} under the QA stub, and
        // `if (proto)` is therefore true for an object that cannot be cloned —
        // so the build died on "proto.clone is not a function" the first time a
        // new block rolled a 24-HR-DAIQIRI sign. It never fired before because
        // no block below the old CITY.minZ ever drew one. Checking the method
        // that is actually called is the guard that matches the use.
        const proto = ctx.getSheriffProto && ctx.getSheriffProto();
        if (proto && typeof proto.clone === "function") {
          const car = proto.clone(true);
          car.position.set(b.cx + 3, proto.position.y, b.z0 - 3.2);
          car.rotation.y = Math.PI / 2;
          scene.add(car);
          ctx.addBlocker(b.cx + 3, b.z0 - 3.2, 2);
        }
      }
      pois.push({ x: b.cx, z: b.z0 - 3, r: 6 });
    }
  }

  function hospital(b) {
    mesh(new THREE.BoxGeometry(b.x1 - b.x0 - 2, 11, b.z1 - b.z0 - 4), std("plaster wall", 0xd8d6cf), b.cx, 5.5, b.cz);
    placeOfficeClutter(ctx, b.cx - 6, b.z0 + 3);
    // the sign has lost a few letters
    const sign = canvasTex(1024, 128, (x, w, h) => {
      x.fillStyle = "#f4f2ea"; x.fillRect(0, 0, w, h);
      x.fillStyle = "#1f4f8a"; x.font = "bold 70px Arial"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText("ORLEAR UGE  PUB IC  HOSP TAL", w / 2, h / 2 + 4);
    }, false);
    const m = new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.5, name: "signboard" });
    m.userData.gtbRealized = true;
    mesh(new THREE.BoxGeometry(18, 2.2, 0.3), m, b.cx, 9, b.z0 - 0.2, { cast: false });
    for (const [bx, bz] of [[-8, 0], [0, 0], [8, 0]]) ctx.addBlocker(b.cx + bx, b.cz + bz, (b.z1 - b.z0) / 2 - 2);
    occluders.push({ minX: b.x0 + 1, maxX: b.x1 - 1, minY: 0, maxY: 11, minZ: b.z0 + 2, maxZ: b.z1 - 2 });
    if (ctx.addService) ctx.addService({ kind: "hospital", name: "OrleaRouge Public Hospital", x: b.cx, z: b.z0 - 1.8, face: Math.PI });
    pois.push({ x: b.cx, z: b.z0 - 4, r: 7 });
  }

  // St. Louis No. 1: oven vaults, above-ground family tombs in narrow alleys,
  // the Glapion tomb, and Marie Laveau's ghost keeping the place after dark.
  // It used to be fifteen boxes with pyramid lids on a lawn. See cemetery.js.
  function cemetery(b) {
    graveyard = createCemetery(ctx, b);
    pois.push({ x: b.cx, z: b.z0 - 3, r: 6 });     // mourners and tour groups outside the gate
  }

  function construction(b) {
    const steel = std("steel beam", 0xc98a2a, { metalness: 0.5, roughness: 0.5 });
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    placeOfficeClutter(ctx, b.cx + 5, b.z0 + 4);
    // an unfinished tower frame
    for (const [cx, cz] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) {
      mesh(new THREE.BoxGeometry(0.6, 22, 0.6), steel, b.cx + cx - 4, 11, b.cz + cz);
      ctx.addBlocker(b.cx + cx - 4, b.cz + cz, 0.6);
    }
    for (let y = 5; y < 22; y += 5.5) mesh(new THREE.BoxGeometry(13, 0.4, 11), std("concrete slab", 0x9a968e), b.cx - 4, y, b.cz);
    // the crane
    mesh(new THREE.BoxGeometry(1.4, 38, 1.4), steel, b.cx + 9, 19, b.cz + 6);
    mesh(new THREE.BoxGeometry(30, 1, 1), steel, b.cx + 1, 38, b.cz + 6);
    mesh(new THREE.BoxGeometry(3, 2.2, 2.2), std("concrete block", 0x6a6a6a), b.cx + 13, 36.9, b.cz + 6);
    mesh(new THREE.SphereGeometry(0.35, 8, 6), basic(new THREE.Color(0xff2a1a).multiplyScalar(3)), b.cx - 14, 38.8, b.cz + 6, { cast: false });
    ctx.addBlocker(b.cx + 9, b.cz + 6, 1.2);
    // hoarding along the street
    const hoard = canvasTex(512, 128, (x, cw, ch) => {
      x.fillStyle = "#1f3a5a"; x.fillRect(0, 0, cw, ch);
      x.fillStyle = "#f4efe4"; x.font = "bold 44px Georgia"; x.textAlign = "center";
      x.fillText("PELICAN CROWN", cw / 2, 58); x.font = "italic 30px Georgia"; x.fillText("Luxury Riverfront Living", cw / 2, 102);
    }, false);
    const hm = new THREE.MeshStandardMaterial({ map: hoard, name: "signboard" });
    hm.userData.gtbRealized = true;
    mesh(new THREE.BoxGeometry(w - 2, 2.4, 0.2), hm, b.cx, 1.2, b.z0);
    for (let x = b.x0 + 2; x < b.x1 - 1; x += 3) ctx.addBlocker(x, b.z0, 0.8);
    pois.push({ x: b.cx, z: b.z0 - 3, r: 5 });
  }

  /**
   * US-167 crosses the Gulf. It always did — the highway runs the length of the
   * map at ROAD_X and simply carried on north into the water — and with the
   * water sitting at y 0.03 and the asphalt at ~0.02, the sea closed over the
   * road and left its lane markings floating on the surface.
   *
   * So it gets a bridge. Low, flat and very long, which is not a compromise: it
   * is exactly what the Lake Pontchartrain Causeway is, twenty-four miles of
   * deck a few feet above the water, and it is the most Louisiana structure
   * there is.
   *
   * It has to be LOW for a second reason. Vehicles in this game move in x and z
   * only — nothing samples terrain height, and `stepArcadeVehicle` never
   * touches y — so a raised deck would have cars driving through the air under
   * it. The deck top sits at 0.12, just clear of the water, and the parapets
   * and pilings do the work of reading as a bridge.
   */
  function gulfCauseway(shoreZ, gulfD) {
    const x = ctx.ROAD_X;
    const half = ctx.ROAD_HALF + 1.8;          // carriageway plus a shoulder each side
    const z0 = shoreZ - 8;                     // start on land so there is no seam at the bank
    const z1 = shoreZ + gulfD + 8;             // and land again on the far side
    const len = z1 - z0, zc = (z0 + z1) / 2;
    const deck = std("concrete bridge deck", 0x8e8b84, { roughness: 0.92 });
    const parapet = std("concrete bridge parapet", 0x9d9a92, { roughness: 0.9 });
    const pile = std("concrete bridge piling", 0x6f6c66, { roughness: 0.95 });

    // the deck: top at 0.12, just proud of the water at 0.03
    mesh(new THREE.BoxGeometry(half * 2, 0.24, len), deck, x, 0.0, zc, { cast: false });
    // the running surface, so it reads as road rather than as a slab
    const asphalt = ctx.surface("asphalt", 1024);
    const road = asphalt.material(1);
    for (const t of [road.map, road.normalMap, road.roughnessMap]) {
      if (t) t.repeat.set(1, len / 9);
    }
    plane(ctx.ROAD_HALF * 2, len, road, x, 0.125, zc);

    // parapets, and blockers so the Gulf is not a driving hazard
    for (const side of [-1, 1]) {
      const px = x + side * (half - 0.2);
      mesh(new THREE.BoxGeometry(0.4, 0.95, len), parapet, px, 0.6, zc, { cast: true });
      for (let z = z0; z <= z1; z += 3) ctx.addBlocker(px, z, 0.45);
      // a rail along the top, same iron as the promenade
      const rail = std("wrought iron railing", 0x1c1f22, { metalness: 0.6, roughness: 0.5 });
      mesh(new THREE.BoxGeometry(0.09, 0.09, len), rail, px, 1.22, zc, { cast: false });
      for (let z = z0 + 2; z < z1; z += 6) {
        mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), rail, px, 0.95, z, { cast: false });
      }
    }

    // pilings, in pairs, marching out into the water
    for (let z = z0 + 5; z < z1; z += 9) {
      for (const side of [-1, 1]) {
        mesh(new THREE.BoxGeometry(0.9, 3.2, 0.9), pile, x + side * (half - 1.1), -1.5, z, { cast: false });
      }
      // a cross beam under the deck, visible from the water
      mesh(new THREE.BoxGeometry(half * 2 - 0.6, 0.3, 0.5), pile, x, -0.22, z, { cast: false });
    }

    // lamps down the middle of the span, on the pattern the boulevard uses
    for (let z = shoreZ + 12; z < shoreZ + gulfD; z += 34) {
      ctx.addLitSpot({ x: x + half - 0.2, y: 6, z, warm: 0xffd9a0, power: 95, range: 24, pole: true });
    }
    occluders.push({ minX: x - half, maxX: x + half, minY: 0, maxY: 1.4, minZ: z0, maxZ: z1 });
  }

  function riverfront() {
    // The Gulf, not a river. This was a silt-brown Mississippi; the brief is now
    // open salt water, so it is green-blue — the Gulf of Mexico's colour comes
    // from depth and plankton rather than from suspended mud, which is why it
    // reads emerald-to-teal offshore instead of café-au-lait.
    //
    // Lower roughness than the silt version and a slightly stronger environment
    // term: clear sea takes a sharper sky reflection than a river carrying half
    // of Missouri in suspension.
    const gulf = new THREE.MeshPhysicalMaterial({
      color: 0x1a4a4c, roughness: 0.11, clearcoat: 1, clearcoatRoughness: 0.06,
      envMapIntensity: 1.3, name: "gulf water",
    });
    gulf.userData.gtbRealized = true;
    // KEEP THIS ABOVE ZERO. It was drawn at y = -0.25 — BELOW the world ground.
    // main.js's buildGround() lays one plane across the whole 2400 m state at
    // y = 0, so the water was buried under it and never visible at all: the
    // Grand Crescent sat on grass. Everything in this game stacks in small
    // positive increments for exactly that reason (GROUND_Y in main.js, and the
    // causeway swamp above at 0.035).
    //
    // How far out it goes. +z is SOUTH in this world (the causeway at z 136 is
    // north of the city at 196–382), so open water on the far side of the
    // promenade is geographically where the Gulf belongs.
    //
    // DEPTH IS CONSTRAINED BY LAND, not by taste. Running this 320 m out to hide
    // the far bank was tried and reverted: there are ~220 blockers between z 386
    // and 706 across this whole frontage — stateWorld.js's own tree scatter,
    // plus a structure around x 550 — and a gulf with two hundred pines standing
    // in it looks far worse than a narrower one that reads clean. main.js's
    // buildTrees already keeps out of everything past z 142; this scatter
    // belongs to another module and clearing it is that module's job.
    //
    // So: the authored 80 m footprint, which reads as one of the sounds and
    // bays the Louisiana coast is actually made of — salt water with land on
    // the far side, which is Mississippi Sound and Lake Borgne, not a river.
    // See AGENT_LOG for what a true open-water horizon would take.
    const SHORE_Z = CITY.maxZ + 1;          // the promenade railing sits at +1.2
    const GULF_D = 80;
    const GULF_W = CITY.maxX - CITY.minX + 40;
    plane(GULF_W, GULF_D, gulf, (CITY.maxX + CITY.minX) / 2, 0.03, SHORE_Z + GULF_D / 2);

    // ---- the swell ----
    // A river's surface travels ALONG the channel. A sea's does not: the swell
    // rolls shoreward, and its crests lie parallel to the beach. Same texture
    // orientation as before — `stretch > 1` puts the crests along x, which here
    // is along the shore — but it now scrolls on the OTHER axis.
    //
    // The plane is rotated -90° about x, so its local +y maps to world -z.
    // Increasing the v offset therefore walks the swell toward the shore, which
    // is the one direction ocean waves are ever seen to go.
    //
    // Long period, low amplitude: the Gulf off Louisiana is shallow and fetch-
    // limited, so it runs to a lazy 3-4 second chop rather than Pacific
    // groundswell. Crest speed ~3 m/s reads as that without looking like a
    // washing machine.
    const TILE = 34;                       // metres per repeat: sea swells are longer than river ripples
    const swell = waterNormalTex(256, 7);
    swell.repeat.set(GULF_W / TILE, GULF_D / TILE);
    const chop = waterNormalTex(256, 4);
    chop.repeat.set(GULF_W / (TILE * 0.4), GULF_D / (TILE * 0.4));
    gulf.normalMap = swell;
    gulf.normalScale = new THREE.Vector2(0.7, 0.7);
    gulf.clearcoatNormalMap = chop;
    gulf.clearcoatNormalScale = new THREE.Vector2(0.35, 0.35);
    gulf.needsUpdate = true;
    currents.push(
      { map: swell, tile: TILE, speed: 3.0 },              // the swell, rolling in
      { map: chop, tile: TILE * 0.4, speed: 4.4 },         // wind chop over the top of it
    );

    gulfCauseway(SHORE_Z, GULF_D);
    // promenade railing, solid
    const rail = std("wrought iron railing", 0x1c1f22, { metalness: 0.6, roughness: 0.5 });
    mesh(new THREE.BoxGeometry(CITY.maxX - CITY.minX, 0.08, 0.08), rail, 0, 1.0, CITY.maxZ + 1.2, { cast: false });
    for (let x = CITY.minX + 2; x < CITY.maxX; x += 2.5) {
      mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), rail, x, 0.5, CITY.maxZ + 1.2, { cast: false });
    }

    // the casino riverboat
    const white = std("painted hull", 0xf2efe6), red = std("painted trim", 0xb3261e);
    const bx = 48, bz = CITY.maxZ + 16;
    mesh(new THREE.BoxGeometry(34, 3, 11), white, bx, 1.2, bz);
    mesh(new THREE.BoxGeometry(28, 2.6, 9), white, bx, 4.0, bz);
    mesh(new THREE.BoxGeometry(18, 2.4, 7), white, bx, 6.5, bz);
    for (const y of [2.8, 5.3]) mesh(new THREE.BoxGeometry(34.4, 0.3, 11.4), red, bx, y, bz, { cast: false });
    const wheel = mesh(new THREE.CylinderGeometry(3.6, 3.6, 2.4, 16), red, bx + 19, 2.6, bz);
    wheel.rotation.z = Math.PI / 2;
    for (const sx of [-4, 4]) mesh(new THREE.CylinderGeometry(0.6, 0.7, 6, 10), std("steel stack", 0x1c1c1c), bx + sx, 10.5, bz);
    const bulb = basic(new THREE.Color(0xffe6a8).multiplyScalar(2.5));
    for (let i = 0; i < 16; i++) mesh(new THREE.SphereGeometry(0.16, 6, 5), bulb, bx - 16 + i * 2.1, 5.45, bz - 5.5, { cast: false });
    neonSign("GRAND CRESCENT CASINO", "#ffd23a", "#2a0808", 16, 2.2, bx, 9.2, bz - 3.6, Math.PI, 0.08);
    ctx.poolLight(0xffd9a0, 60, 34, bx, 8, bz - 6);
    pois.push({ x: bx, z: CITY.maxZ - 3, r: 10 });
    pois.push({ x: -40, z: CITY.maxZ - 3, r: 10 });
  }

  // ---------------------------------------------------------------- build
  function buildSet() {
    buildCauseway();
    // The road out, and the overpass finished. Both are edge work rather than
    // city work, so they live in their own module — but they are built HERE,
    // before the grid, because the fringe's ramps tie into the last avenue and
    // the overpass sits on the causeway the grid has to meet.
    fringe = createOrleaFringe(ctx);
    scene.add(fringe.build());
    buildStreets();
    // the river edge first: it is south of the grid and joins onto the levee,
    // which is built at the end, so nothing here can be laid on top of it
    riverEdge();
    const bl = blocks();
    const pick = (x, z) => bl.find((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
    const special = new Set();
    const hosp = pick(-26, 350), cem = pick(-110, 350), site = pick(94, 230);
    if (hosp) { hospital(hosp); special.add(hosp); }
    if (cem) { cemetery(cem); special.add(cem); }
    if (site) { construction(site); special.add(site); }
    // blocks other modules build on (main.js passes them: the Pay 'n' Spray lot, the clubs)
    for (const lot of ctx.lots || []) {
      const b = pick(lot.at[0], lot.at[1]);
      if (b && !special.has(b)) { special.add(b); lot.build(b); }
    }
    // The named landmarks claim their blocks BEFORE any ordinary builder runs,
    // so a cathedral never lands on top of a rowhouse terrace. "Recognizable"
    // was the requirement, and a landmark buried under a block of housing is
    // not recognizable.
    landmarks.build(bl, special);
    if (landmarks.missing.length) console.warn(`[orlearouge] no superblock for: ${landmarks.missing.join(", ")}`);
    // A superblock nobody claimed must not be built on. The grid is taken out
    // there on purpose — leaving a hole in the paving and then dropping a
    // midrise into it is worse than the hole, because the hole read as a gap in
    // the plan and the midrise reads as a mistake.
    for (const b of bl) if (b.reserve && !special.has(b)) { grassyReserve(b); special.add(b); }
    const rest = bl.filter((b) => !special.has(b));
    // Every builder claims by ZONE, so exactly one of them takes each block and
    // the order they run in no longer decides what a block becomes.
    //
    // The gateway is the exception, and it has to run first: it claims by
    // POSITION (the arrival band, west of the boulevard) rather than by zone,
    // so the two districts it overlaps — the Quarter and the West Bank — would
    // otherwise both still claim those blocks by zone and this would be a third
    // builder writing on top of a block someone else already built. So it runs
    // first and its claims are subtracted from `rest` below, which keeps the
    // one-block-one-builder invariant intact.
    const gateway = new Set();
    for (const b of rest) if (b.cz < 210 && b.cx < ctx.ROAD_X) gateway.add(b);
    gatewayDistrict(rest.filter((b) => gateway.has(b)));
    const rest2 = rest.filter((b) => !gateway.has(b));
    westBank(rest2);
    outskirts(rest2);
    frenchDistrict(rest2);
    gardenDistrict(rest2);
    downtown(rest2);
    midtown(rest2);
    civicEnd(rest2);
    shops(rest2);
    riverfront();
    levee();
    // The people. Traffic makes a road look used; it does not make a street look
    // like a street. Routes are generated from this module's own grid, so the
    // beats run along real pavements rather than across open ground.
    streetLife.build(streetLife.makeRoutes({
      avenues: AVENUES, streets: STREETS, width: STREET_W,
      minX: CITY.minX, maxX: CITY.maxX, minZ: CITY.minZ, maxZ: CITY.maxZ,
      roadX: ctx.ROAD_X,
    }));
    // street corners along the boulevard are where people hang out
    for (const z of STREETS) pois.push({ x: ctx.ROAD_X + 10, z: z + 7, r: 5 }, { x: ctx.ROAD_X - 10, z: z - 7, r: 5 });
    // …and the corners of the new eastern streets, or a metropolis that is only
    // busy along one boulevard reads as a strip
    for (const z of STREETS) {
      for (const x of [114, 274, 434, 594]) {
        if (x > CITY.maxX - 30) continue;
        pois.push({ x: x - 8, z: z + 7, r: 5 }, { x: x + 8, z: z - 7, r: 5 });
      }
    }

    // Add parked cars to some streets: up on the sidewalk edge, clear of the lanes.
    // Not on the arterials (250, 330, 410), whose four lanes fill all 9 m of the
    // street, and not inside a superblock, where there is no street at all. They
    // used to sit on the kerb line (z ± 4.5) of every street, in the outer lane.
    const cars = ["beatall", "doclorean", "landyroamer", "toyoyo", "tristar"];
    let c = 0;
    for (const z of STREETS) {
      if (z <= 210 || z === 250 || z === 330 || z === 410) continue;   // not the causeway boundary, not an arterial
      for (const [x, dz, ry] of [[ctx.ROAD_X + 20, -5.6, -Math.PI / 2], [ctx.ROAD_X - 30, 5.6, Math.PI / 2]]) {
        if (inReserve(x, z + dz, 4)) continue;
        placeParkedCar(ctx, cars[c++ % cars.length], x, z + dz, ry);
      }
    }

    // The fringe's lane paint is its own batched geometry and has to go into the
    // world after the group is parented, or it is drawn at the origin.
    fringe?.flushMarkings(scene);
  }

  return {
    buildSet,
    /** Pure, and tested: where the floodwall is wall and where it is a gate. */
    leveeRuns,
    /** The street grid, for the minimap: north–south avenues at x, east–west streets at z. */
    grid: { avenues: AVENUES, streets: STREETS, width: STREET_W, city: CITY, causeway: CAUSEWAY },
    /**
     * The plots, for the block-interior survey (tools/qa/block_interiors_test).
     *
     * Every builder here claims a block BY ZONE, so the only honest way to ask
     * "is the middle of this block full?" is from the same list the builders get.
     * Reconstructing the grid in the test would be a second implementation of
     * `blocks()` waiting to drift, which is how the district probes in this repo
     * have gone wrong three times.
     */
    get blocks() { return blocks(); },
    /** The dressed back-of-block strips, for the block-interior survey. */
    get alleys() { return alleys; },
    /**
     * The two strips that are not block grid, for the same survey: the river
     * edge between the two cities, and the floodwall the city ends on. Named
     * rects rather than a duplicated copy — the survey reads them, it does not
     * decide them.
     */
    get seam() { return { ...SEAM }; },
    get floodwall() { return { x0: LEVEE.railX - 16, x1: LEVEE.x + 8, z0: SEAM.z0, z1: CITY.maxZ }; },
    get pois() { return pois; },
    get occluders() { return occluders; },
    /** Anything in the city that moves — main.js keeps these out of batchStatic. */
    get props() { return [...streetLife.props, ...(graveyard ? graveyard.props : [])]; },
    get streetLife() { return streetLife; },
    /** The road out of the city and the finished overpass (orleafeinge.js). */
    get fringe() { return fringe; },
    /** F at Marie Laveau's tomb. main.js tries this in its interact chain. */
    interact() { return graveyard ? graveyard.interact() : false; },
    get cemetery() { return graveyard; },
    get entered() { return entered; },
    /** Keep trees and scattered decor out. */
    contains(x, z) { return z > CAUSEWAY.minZ; },
    // The rural parish lies west of the city. It used to be bounded on those two sides only, which was
    // right while the map ended here; with the state around it, everything south and east of OrleaRouge
    // (Oyster Bay, US-167 south, the Lakeshore road) counted as the city too: no NPC ever spawned
    // there (the city spawns at its own POIs) and the "EXT. ORLEAROUGE" card fired in Oyster Bay.
    inCity(x, z) {
      // The seam counts. It is 142 m of city frontage between two districts, and
      // leaving it outside `inCity` means the spawn zones never place anyone on
      // it and the map calls it somewhere else — which is how a strip with
      // warehouses, a canal and a fuel tank ends up behaving like a field.
      if (x >= SEAM.x0 - 2 && x <= SEAM.x1 + 2 && z >= SEAM.z0 && z <= SEAM.z1) return true;
      return z > CITY.minZ && z < CITY.maxZ + 8 && x >= CITY.minX - 2 && x <= CITY.maxX + 2;
    },

    /**
     * Traffic lanes, generated from the grid rather than listed by hand. They
     * used to be four fixed pairs at z 210/250/330/370, which meant a
     * five-street grid had one street with no traffic on it and — once the grid
     * grew to seven — that two of them carried nothing at all.
     */
    lanes: (() => {
      const out = [];
      // The river edge, so the seam is driven rather than looked at. It is a
      // loop's worth of road: two east–west service roads and the link between
      // them, which is why these are lanes and not a dead-end pair.
      for (const z of [SEAM.z0 + 18, SEAM.z1 - 18]) {
        out.push({ name: `River Edge ${z} eastbound`, points: [[SEAM.x0 + 2, z + 2.4], [SEAM.x1 - 2, z + 2.4]], cruise: [8, 13] });
        out.push({ name: `River Edge ${z} westbound`, points: [[SEAM.x1 - 2, z - 2.4], [SEAM.x0 + 2, z - 2.4]], cruise: [8, 13] });
      }
      out.push({ name: "River Edge link northbound", points: [[SEAM.x1 - 21.6, SEAM.z0 + 16], [SEAM.x1 - 21.6, SEAM.z1 - 18]], cruise: [7, 11] });
      out.push({ name: "River Edge link southbound", points: [[SEAM.x1 - 26.4, SEAM.z1 - 18], [SEAM.x1 - 26.4, SEAM.z0 + 16]], cruise: [7, 11] });
      for (const z of STREETS) {
        // eastbound gets +z and westbound -z: with -z as north, that is each
        // one's own right. It was the other way round, so the whole grid's
        // side streets drove on the left.
        const [a, b] = [z + 2.4, z - 2.4];
        // arterials get four lanes, side streets two
        const wide = z === 250 || z === 330 || z === 410;
        // Cut where the asphalt is cut (buildStreets, same test): a street stops at a superblock's edge.
        // These lanes used to run the whole width of the city regardless, so traffic drove straight
        // through the Superdome, City Park, Loyola and the Cathedral on roads that were never drawn.
        const cuts = STREET_CUTS.filter((r) => z > r.z0 - STREET_W && z < r.z1 + STREET_W).sort((p, q) => p.x0 - q.x0);
        const runs = [];
        let from = CITY.minX + 4;
        for (const r of cuts) { runs.push([from, r.x0 - 2]); from = Math.max(from, r.x1 + 2); }
        runs.push([from, CITY.maxX - 4]);
        runs.filter(([x0, x1]) => x1 - x0 >= 24).forEach(([x0, x1], k) => {
          const road = {
            name: k ? `OrleaRouge ${z}~${k}` : `OrleaRouge ${z}`,
            points: [[x0, z], [x1, z]],
            cruise: wide ? [10, 16] : [8, 13],
          };
          if (wide) out.push(...makeRoadway({ ...road, lanes: 2, median: 0.4, laneWidth: 2.4 }));
          else {
            out.push({ ...road, name: `${road.name} eastbound`, points: [[x0, a], [x1, a]] });
            out.push({ ...road, name: `${road.name} westbound`, points: [[x1, b], [x0, b]] });
          }
        });
      }
      return out;
    })(),

    update(dt) {
      if (graveyard) graveyard.update(dt);
      streetLife.update(dt, ctx.playerPos);
      // The swell rolls in. `offset` shifts where the texture is SAMPLED, so the
      // pattern travels the opposite way — and the plane's local +y is world
      // -z, so ADDING to offset.y walks the crests shoreward.
      for (const c of currents) {
        c.map.offset.y = (c.map.offset.y + (c.speed / c.tile) * dt) % 1;
      }
      const t = performance.now() / 1000;
      for (const n of neon) {
        // mostly steady, with the occasional sputter
        const s = Math.sin(t * n.speed + n.phase);
        const dip = s > 0.97 ? n.flicker * 3 : Math.max(0, s) * n.flicker;
        if (n.color) n.mat.color.copy(n.color).multiplyScalar(n.base * (1 - dip));
        else n.mat.emissiveIntensity = n.base * (1 - dip);
      }
      if (!entered && ctx.playerPos.z > CITY.minZ + 6 && ctx.playerPos.z < CITY.maxZ + 8 && ctx.playerPos.x > CITY.minX - 2 && ctx.playerPos.x < CITY.maxX + 2 && !ctx.state.cinematic) {   // inside the grid (not merely south-east of its corner: Oyster Bay, the prison...)
        entered = true;
        ctx.cine.scene(async (c) => {
          c.card("EXT.", "ORLEAROUGE", POP_TEXT + " · Gorgeous and wounded");
          await c.wait(1.2);
          // Keseme's "OrleaRouge teaches you two things / Life can be beautiful
          // / And beauty doesn't make you safe" VO beat used to be here, with a
          // gunshot punctuating it. Removed on request (2026-10-01): it read as
          // a corny self-help epilogue tacked onto the arrival. The title card
          // alone lands the place; the city does the rest.
        });
      }
    },
  };
}