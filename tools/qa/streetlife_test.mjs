// Street life (streetlife.js).
//
//   node --experimental-detect-module tools/qa/streetlife_test.mjs
//
// "general city-like NPCs like businessmen and like cops patrolling streets etc"
//
// The city grew by 140-odd blocks of new building and this is the part that
// makes any of it look inhabited. The things worth testing are behavioural
// rather than structural: a walker that exists but does not MOVE is a mannequin,
// a cop that only appears when you are wanted is not a patrol, and a population
// that is not culled is a performance problem that only shows up on the
// machine you tested on.

import * as THREE from "three";
import { createStreetLife, ACTIVE_RADIUS } from "../../src/streetlife.js";

let seed = 4242;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
Math.random = rng;
// The 2D-context stub is the one act_test.mjs / stripper_test.mjs use, because
// this is the same code path: streetlife casts REAL characters (makeDeputy,
// randomTuxedo, ...), and those draw their micro-surface textures on a canvas
// through characters.js. A thinner stub throws inside paisleyMat() on the first
// Hoodrat and the test reports a crash instead of a result.
const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = {
  fillStyle: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
  fillRect: noop, fillText: noop, strokeText: noop, save: noop, restore: noop, translate: noop,
  rotate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: noop,
  lineTo: noop, arc: noop, ellipse: noop, arcTo: noop, rect: noop, fill: noop, stroke: noop,
  clip: noop, clearRect: noop, drawImage: noop, strokeRect: noop,
  createLinearGradient: () => gradient, createRadialGradient: () => gradient,
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: noop, measureText: () => ({ width: 10 }),
  createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  setLineDash: noop, setTransform: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context2d }),
  head: { appendChild() {} }, body: { appendChild() {} },
  getElementById: () => null, addEventListener() {},
};

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL " } ${label}${detail ? `  — ${detail}` : ""}`);
};

const scene = new THREE.Scene();
let night = false;
const S = createStreetLife({ scene, isNight: () => night, rng });

// ---------------------------------------------------------------- routes
{
  const routes = S.makeRoutes({
    avenues: [-86, -46, 34, 114, 274], streets: [250, 330],
    width: 9, minX: -136, maxX: 680, minZ: 196, maxZ: 500, roadX: -6,
  });
  check("routes are generated from the grid", routes.length > 10, `${routes.length} routes`);
  check("there are police beats and there are commuters",
    routes.some((r) => r.kind === "beat") && routes.some((r) => r.kind === "commuter"));
  check("there are crossings over the boulevard", routes.some((r) => r.name.startsWith("crossing")));
  // Every route must be ON the pavement, never in the carriageway. A beat that
  // walks down the middle of the road is worse than no beat.
  const inRoadway = routes.filter((r) => {
    const footway = 9 / 2 + 1.1;
    for (const avenue of [-86, -46, 34, 114, 274]) {
      if (Math.abs(Math.abs(r.a[0] - avenue) - footway) > 0.01) continue;
      // …this point is a kerbside beat; is it also on a street centreline?
      if ([250, 330].some((z) => Math.abs(r.a[1] - z) < footway - 0.5)) return true;
    }
    return false;
  });
  check("no beat is routed down the middle of a street", inRoadway.length === 0, `${inRoadway.length} bad routes`);
  // Beats and commutes must have real length or they are people turning on the
  // spot. Crossings are the exception and legitimately short — 16 m is the
  // width of the boulevard plus both footways, which is what a crossing is.
  const longRoutes = routes.filter((r) => !r.name.startsWith("crossing"));
  check("no beat or commute is a standing start",
    longRoutes.every((r) => Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) > 40),
    `${longRoutes.filter((r) => Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) <= 40).length} short routes`);
  check("a crossing is the width of the road and no more",
    routes.filter((r) => r.name.startsWith("crossing")).every((r) => {
      const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
      return L > 8 && L < 25;
    }));
}

// ---------------------------------------------------------------- build
S.build(S.makeRoutes({
  avenues: [-86, -46, 34, 114, 274], streets: [250, 330],
  width: 9, minX: -136, maxX: 680, minZ: 196, maxZ: 500, roadX: -6,
}));
check("people were cast", S.count > 10, `${S.count} actors`);
check("both kinds are on the street",
  S.actors.some((a) => a.kind === "beat") && S.actors.some((a) => a.kind === "commuter"));
check("every actor is a real rig with meshes", S.actors.every((a) => {
  let n = 0; a.mesh.traverse((m) => { if (m.isMesh) n++; });
  return n > 20;
}));
// people move, so they must never be swept into a static batch
check("nobody is batchable", S.props.every((p) => {
  let ok = true;
  p.traverse((m) => { if (m.isMesh && !m.userData.noBatch) ok = false; });
  return ok;
}), "an unmarked walker would be frozen into the city's static geometry");

// ---------------------------------------------------------------- they move
{
  const player = new THREE.Vector3(0, 0, 300);
  // Snapshot positions BY MESH, not by actor index: the pool now streams
  // records in and out as the player moves, so `S.actors[i]` is not the same
  // person across a hundred frames and an index-keyed snapshot compares one
  // pedestrian's new position against another's old one.
  const before = new Map(S.actors.map((a) => [a.mesh, a.mesh.position.clone()]));
  for (let i = 0; i < 120; i++) S.update(1 / 30, player);
  let moved = 0;
  for (const [mesh, pos] of before) moved += mesh.position.distanceTo(pos) > 1.5 ? 1 : 0;
  check("the crowd actually walks", moved > 5, `${moved} of ${S.count} moved more than 1.5 m`);
  const walking = S.actors.filter((a) => a.mesh.anim === "walk").length;
  check("most of them are on the walk clip", walking > 5, `${walking} walking`);
  // 0.02, not 0.01: characters.js's walk clip deliberately bobs the root
  // (`this.position.y = baseY + |c| * (0.012 + run * 0.03)`) — measured 0.012 m
  // at a walking gait, straight off the rig with no streetlife involved. A 10 mm
  // bound fails against the rig's own animation, so the test was measuring the
  // walk cycle rather than a bug. 20 mm is the real assertion: nobody is
  // levitating or sunk, which is what this check is for.
  check("nobody walks through the floor", S.actors.every((a) => Math.abs(a.mesh.position.y) < 0.02),
    `max |y| ${Math.max(...S.actors.map((a) => Math.abs(a.mesh.position.y))).toFixed(4)} (rig walk bob is 0.012)`);
}

// ---------------------------------------------------------------- beats patrol
{
  // a beat cop must be there in daylight AND after dark, and must keep moving
  // through both. The existing foot-cop system only spawns in response to the
  // player being wanted, so an empty street and a street under martial law
  // looked identical — this is the difference.
  const player = new THREE.Vector3(0, 0, 300);
  const sample = () => {
    const p0 = new Map(S.actors.filter((a) => a.kind === "beat").map((a) => [a.id, a.mesh.position.clone()]));
    for (let i = 0; i < 90; i++) S.update(1 / 30, player);
    return S.actors.filter((a) => a.kind === "beat" && p0.has(a.id))
      .filter((a) => a.mesh.position.distanceTo(p0.get(a.id)) > 1.0).length;
  };
  night = false;
  const dayMoved = sample();
  check("beat cops walk their beats in daylight", dayMoved > 0, `${dayMoved} moved`);
  night = true;
  const nightMoved = sample();
  check("beat cops keep walking after dark", nightMoved > 0, `${nightMoved} moved`);
  check("the beat is still staffed at night", S.actors.filter((a) => a.kind === "beat").length > 0,
    `${S.actors.filter((a) => a.kind === "beat").length} on shift`);
  night = false;
}

// ---------------------------------------------------------------- culling
{
  // The cost of a big city has to be bounded by what you can SEE, not by how
  // much of it exists — but in two stages, and this test used to conflate them
  // by standing 2 km away and then asking that the crowd had been kept. It has
  // not: past KEEP_RADIUS they are deleted on purpose. The band in between
  // (parked, invisible, still cast) is the one worth testing.

  // Out of sight but still inside the keep radius: parked, not deleted.
  // The standee has to be clear of the WHOLE pool, not just of the anchor —
  // the city is 816 m across, so a point 200 m from one walker can still be
  // standing in front of another, and those are correctly still drawn.
  // Culling is per-actor, so the band has to be measured against ONE walker.
  // On the full 44-route city no single standee can be simultaneously beyond
  // 150 m of everybody and within 260 m of somebody — the pool is 800 m across
  // — so this runs on its own two-route pool with the actors 40 m apart. That
  // is the situation the cull/park/despawn branches were written for.
  const C = createStreetLife({ scene: new THREE.Scene(), isNight: () => false, rng });
  C.build([
    { a: [0, 0], b: [200, 0], kind: "beat", name: "test beat", speed: 1 },
    { a: [0, 6], b: [200, 6], kind: "commuter", name: "test commute", speed: 1 },
  ]);
  // The two walks are 6 m apart and both run along +x, so stepping the
  // standee 200 m off in Z puts it the same distance from both of them. (An
  // offset along the route instead leaves the far walker inside the active
  // radius, which is correct behaviour and a confusing test.)
  const mid = new THREE.Vector3();
  for (const a of C.actors) mid.add(a.mesh.position);
  mid.divideScalar(C.count);
  const home = mid.clone();
  // Not 2 any more. A ROUTE is a whole street; a SLOT is one place on it, and
  // density is a question about slots — the city used to put exactly one person
  // per route, which on a 972 m x 370 m grid is one pedestrian per 7,800 m².
  // Two 200 m routes is now a handful of people, which is the point.
  check("the test pool is cast", C.count >= 2 && C.count <= 12, `${C.count} actors over 2 routes`);

  // Standing among them, they are drawn. Measured against the actors actually
  // inside the active radius, not against the whole pool: a pool spread over two
  // 200 m routes is ~400 m end to end, so its centroid can sit 100+ m from its
  // own outermost walkers and those are correctly NOT drawn ("4 of 8"). Asking
  // that every actor in the city be visible from the middle of the city would be
  // asking for no radius at all. The real assertion is: nobody inside the radius
  // is culled, and nobody outside it is drawn.
  C.update(1 / 30, home);
  const nearDraw = C.actors.filter((a) => a.mesh.position.distanceTo(home) < ACTIVE_RADIUS);
  check("walkers are drawn when you are among them",
    nearDraw.length > 0 && nearDraw.every((a) => a.mesh.visible),
    `${nearDraw.filter((a) => a.mesh.visible).length} of ${nearDraw.length} inside ACTIVE_RADIUS`);

  // 200 m off: past ACTIVE_RADIUS (150) so culled, inside KEEP_RADIUS (260) so
  // still cast. This is the band that stops pedestrians popping back into being.
  const parked = new THREE.Vector3(mid.x, 0, mid.z + 200);
  C.update(1 / 30, parked);
  const nearest = Math.min(...C.actors.map((a) => parked.distanceTo(a.mesh.position)));
  check("everybody is culled when you are not there", C.actors.every((a) => a.mesh.visible === false),
    `nearest ${nearest.toFixed(0)} m, ${C.actors.filter((a) => a.mesh.visible).length} still drawn`);
  const parkedCount = C.count;
  check("culled walkers are parked, not deleted", C.count >= 2, `${C.count} kept`);

  // and they come back when you return
  C.update(1 / 30, home);
  check("they come back when you return", C.actors.some((a) => a.mesh.visible),
    `${C.actors.filter((a) => a.mesh.visible).length} drawn`);

  // and are dropped entirely when they are a long way off, so the pool is bounded
  const before = C.count;
  C.update(1 / 30, new THREE.Vector3(5000, 0, 5000));
  check("walkers a long way off are dropped, so the pool is bounded",
    C.count < before, `${before} -> ${C.count} after walking a continent away`);
  check("the active radius is a sane distance", ACTIVE_RADIUS > 60 && ACTIVE_RADIUS < 300, `${ACTIVE_RADIUS} m`);
}

// ---------------------------------------------------------------- no duplicates
{
  S.build(S.makeRoutes({
    avenues: [-86, -46, 34, 114, 274], streets: [250, 330],
    width: 9, minX: -136, maxX: 680, minZ: 196, maxZ: 500, roadX: -6,
  }));
  const ids = S.actors.map((a) => a.id);
  check("no actor is cast twice", new Set(ids).size === ids.length, `${ids.length} actors, ${new Set(ids).size} ids`);
  const meshes = new Set(S.props);
  check("no mesh is in the scene twice", meshes.size === S.props.length);
  // Rebuilding must not leak the old crowd into the scene. Count the parents
  // of the ACTORS rather than every group in the scene: the culling block above
  // deliberately walked to the far side of the map, and the scene the test
  // passes in is shared, so an absolute group count measures the wrong thing.
  let parented = 0;
  for (const p of S.props) if (p.parent === scene) parented++;
  check("every rebuilt walker is parented to the scene", parented === S.count,
    `${parented}/${S.count} in the scene`);
}

if (failures) { console.error(`streetlife_test: ${failures} failure(s)`); process.exit(1); }
console.log("streetlife_test: all checks passed");
