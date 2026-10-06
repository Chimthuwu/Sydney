// The city's east edge, and the overpass.
//
//   node --experimental-detect-module tools/qa/fringe_test.mjs
//
// Both of these came from screenshots, and both are the kind of thing a test
// is for. The city was grown to x = 680 inside a map that runs to 1200, and
// from x = 720 east there was not a single mesh: the metropolis ended in a
// cliff. The elevated crossing was one 150 x 1.2 x 9 m concrete box with no
// deck, no markings, no parapet and no ramp, so from the only angle you
// approach an overpass from it read as a slab.
//
// The measurements that matter:
//   - the road reaches the edge of the world, and there is no hole in it
//   - the overpass is a ROAD: tarmac, markings, something to stop you driving
//     off the side, and a way on and off
//   - and nothing is parked in a running lane, which is a worse bug than a
//     missing road — you cannot drive past a bollard
import assert from "node:assert/strict";
import * as THREE from "three";

const noop = () => {};
const gradient = { addColorStop: noop };
const ctx2d = {
  fillStyle: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
  fillRect: noop, fillText: noop, strokeText: noop, save: noop, restore: noop, translate: noop,
  rotate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
  arc: noop, ellipse: noop, arcTo: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
  clearRect: noop, drawImage: noop, strokeRect: noop,
  createLinearGradient: () => gradient, createRadialGradient: () => gradient,
  getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: noop,
  measureText: () => ({ width: 10 }), createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  setLineDash: noop, setTransform: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }),
  head: { appendChild() {} }, body: { appendChild() {} },
  getElementById: () => null, addEventListener() {},
};

const { createOrleaRouge, CITY } = await import("../../src/orlearouge.js");
const { surface } = await import("../../src/graphics.js");
const characters = await import("../../src/characters.js");
const { EAST_HWY, EAST_HALF } = await import("../../src/orleafeinge.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

// The fringe module on its own, which is what most of these want: building the
// whole city to measure one road is slow and the road does not depend on it.
const scene = new THREE.Scene();
const blockers = [];
const lights = [];
const hooks = new Proxy({
  scene, surface, ROAD_X: -6, ROAD_HALF: 5,
  addBlocker: (x, z, r = 0.8) => blockers.push({ x, z, r }),
  addLitSpot: (s) => lights.push(s), poolLight: noop, flashObjective: noop,
  addService: noop, makeBillboard: noop, makeFence: noop, makeBarrel: noop, makePallet: noop,
  makeNeonSign: () => new THREE.MeshStandardMaterial({ color: 0xff4fb3 }),
  getSheriffProto: () => ({}), lots: [], services: [], pois: [], props: [],
  makeHoodrat: characters.makeHoodrat,
  loadDsCar: () => new Promise(() => {}),
  resolveCollision: (cur, next) => next,
  playerPos: new THREE.Vector3(0, 0, 300),
  worldTime: { isNight: () => false, hour: () => 12 },
  document: globalThis.document,
}, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k === "string" && /(s|list|spots|names|items)$/.test(k)) return [];
    return noop;
  },
});
const { createOrleaFringe } = await import("../../src/orleafeinge.js");
const fringe = createOrleaFringe(hooks);
const { EDGE } = fringe;
scene.add(fringe.build());
fringe.flushMarkings(scene);
scene.updateMatrixWorld(true);
const meshes = [];
scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
const named = (re) => meshes.filter((o) => re.test(o.name || ""));
console.log(`fringe: ${meshes.length} meshes, ${blockers.length} blockers, ${lights.length} lights\n`);

// ---------------------------------------------------------------- the road
{
  const { x0, x1, z } = EAST_HWY;
  check("the road starts at the edge of the grid", x0 >= CITY.maxX - 12, `x0 ${x0} vs city edge ${CITY.maxX}`);
  check("...and runs to the edge of the world", x1 >= 1150, `ends at x ${x1}`);

  // it must be CONTINUOUS: sample along it and demand tarmac the whole way
  const surface = meshes.filter((o) => o.name === "fringe tarmac");
  assert.ok(surface.length >= 2, "there is tarmac");
  const spans = surface.map((m) => {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    return { x0: m.position.x + bb.min.x, x1: m.position.x + bb.max.x, z: m.position.z };
  });
  const roadSpans = spans.filter((s) => Math.abs(s.z - z) < EAST_HALF + 1);
  const widest = roadSpans.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a), { x0: Infinity, x1: -Infinity });
  check("one carriageway runs the whole length without a gap",
    widest.x1 - widest.x0 > x1 - x0 - 2, `${(widest.x1 - widest.x0).toFixed(0)} m of ${x1 - x0} m`);

  // and it is actually a ROAD wide enough to drive
  // The tarmac planes are rotated -90 deg about x, so their geometry bbox is in
  // the plane's OWN frame: width runs along local Y and length along local X,
  // not along world Z. Measuring the world-space depth of the bounding box
  // therefore reports 0 for a 14 m road, which is what the first run of this
  // test did. `mesh.rotation.x = -PI/2` swaps them, so measure local Y.
  const widestDepth = Math.max(...surface.map((m) => {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    return Math.max(bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  }));
  check("the carriageway is wide enough to drive on", widestDepth > 7, `${widestDepth.toFixed(1)} m wide`);
}

{
  // A divided road needs a median, or four lanes read as one very wide road
  // and traffic has nowhere to go.
  const median = named(/^median kerib|^median kerb/);
  check("the road is divided by a raised median", named(/median kerb/).length === 1, `${named(/median kerb/).length} kerb(s)`);
  check("...with a barrier down the middle of it", named(/median barrier rail/).length >= 1);
  check("...and posts along it", named(/median barrier pos|median barrier post/).length > 5,
    `${named(/median barrier post/).length} posts`);
}

{
  // The paint. This is the difference between a road and a runway, and it is
  // invisible in a mesh count, so it is checked on the markings module's own
  // queue: flushed paint means the quads were actually built.
  const paint = meshes.filter((o) => o.userData?.gtbPaint);
  check("the road has paint on it", paint.length > 0, `${paint.length} paint mesh(es)`);
  if (paint.length) {
    let quads = 0;
    for (const m of paint) quads += m.geometry.attributes.position.count / 4;
    check("...and a lot of it — lane lines, edge lines, a centre", quads > 100, `${Math.round(quads)} quads`);
  }
}

{
  check("the road is lit", lights.length > 8, `${lights.length} lamp posts`);
  check("...with poles to hang them on", named(/highway light pole/).length > 8, `${named(/highway light pole/).length}`);
}

{
  // A highway with no way on or off is a runway, and a city you cannot drive
  // out of is a diorama.
  const on = named(/^on-ramp$/), off = named(/^off-ramp$/);
  check("there are on-ramps off the city streets", on.length >= 4, `${on.length} segments`);
  check("...and off-ramps back down", off.length >= 4, `${off.length} segments`);
  // and they must actually START on a city street, not in a field
  const onPos = new THREE.Vector3();
  on[0].getWorldPosition(onPos);
  check("a ramp starts inside the city grid", onPos.x < CITY.maxX, `first ramp segment at x ${onPos.x.toFixed(0)}`);
  // and reach the carriageway
  let nearest = Infinity;
  for (const m of on) {
    const p = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
    nearest = Math.min(nearest, Math.abs(p.z - EAST_HWY.z));
  }
  check("...and reaches the carriageway", nearest < 8, `closest approach ${nearest.toFixed(1)} m from the centreline`);
}

// ---------------------------------------------------------------- nothing in the lane
{
  // The bug this whole ramp-channel business exists to prevent: a wall of
  // blockers across the running lane of the biggest road in the game.
  const { lanes, median, laneWidth, x0, z } = EAST_HWY;
  const inner = median / 2, halfRoad = lanes * laneWidth / 2;
  const inLane = blockers.filter((b) => {
    const off = Math.abs(b.z - z);
    return b.x > x0 && off > inner + 0.6 && off < inner + halfRoad;
  });
  check("nothing is parked in a running lane", inLane.length === 0,
    inLane.length ? inLane.slice(0, 4).map((b) => `(${b.x.toFixed(0)},${b.z.toFixed(0)})`).join(" ") : "clear");
}

// ---------------------------------------------------------------- the overpass
{
  const Z = 172, Y = 8;
  // The kerb and parapet sit outboard of the 9 m deck (z 168 and 176) and a
  // little above it, so the window has to span the whole structure — a |z-172|
  // of 4 excludes the very pieces it is checking for.
  const near = (re) => meshes.filter((o) => {
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    return re.test(o.name || "") && Math.abs(p.z - Z) < 6 && p.y > Y - 1;
  });
  check("the overpass has a driving surface on top of the structure", near(/fringe tarmac/).length >= 1,
    `${near(/fringe tarmac/).length} deck(s)`);
  check("...with a kerb down each side", near(/overpass kerb/).length === 2, `${near(/overpass kerb/).length}`);
  check("...and a crash barrier you cannot drive through", near(/overpass parapet/).length === 2,
    `${near(/overpass parapet/).length} parapet(s)`);
  check("...which is made of posts, not a painted line", near(/parapet post/).length > 20,
    `${near(/parapet post/).length} posts`);
  check("...and there is a ramp up onto it", named(/overpass ramp/).length >= 12, `${named(/overpass ramp/).length} segments`);

  // the deck must be SOLID along its whole length, or the middle is a gap
  const deck = near(/fringe tarmac/);
  if (deck.length) {
    if (!deck[0].geometry.boundingBox) deck[0].geometry.computeBoundingBox();
    const bb = deck[0].geometry.boundingBox;
    const len = bb.max.x - bb.min.x;
    check("the deck runs the whole span of the crossing", len > 140, `${len.toFixed(0)} m`);
  }
  // and blocked at both edges
  const edge = blockers.filter((b) => Math.abs(b.z - Z) < 5);
  check("the parapet is solid to cars and walkers", edge.length > 20, `${edge.length} blockers along the deck`);
}

// ---------------------------------------------------------------- the edge strip
{
  // The road survey said the network is finished and the ground beside it is
  // not, and this is the part that fixes the second half. A four-lane arterial
  // with 500 m of nothing either side is a runway, not the edge of a city.
  const { from, to, frontage, frontageW } = EDGE;
  const east = named(/^edge /);

  check("there is something built along the arterial", east.length > 200, `${east.length} edge meshes`);
  // "on both sides" is a question about which side of the centreline a building
  // stands on, not about how many meshes share a prefix — the first version of
  // this counted 134 "motels" and called it a failure.
  const zOf = (m) => new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).z;
  for (const [side, label] of [[-1, "north"], [1, "south"]]) {
    const here = named(/^edge (motel|carLot|shop|truckStop|showroom)$/)
      .filter((m) => Math.sign(zOf(m) - EAST_HWY.z) === side);
    check(`...on the ${label} side of it`, here.length >= 2, `${here.length} buildings`);
  }

  // It has to run most of the way out, or the city still ends in a cliff —
  // which is the exact complaint this was built for.
  const poles = named(/^edge power pole$/);
  check("a power line marches out along the strip", poles.length >= 20, `${poles.length} poles`);
  if (poles.length) {
    const xs = poles.map((m) => m.position.x);
    const covers = Math.max(...xs) - Math.min(...xs);
    check("...the whole way to the edge of the world", covers > (to - from) * 0.9, `${covers.toFixed(0)} m of ${to - from} m`);
  }
  check("...with wires strung between them", named(/^edge power wire$/).length > 100,
    `${named(/edge power wire/).length} spans`);

  // A service road is a road, not a stripe: it is paved, painted and drivable.
  const apron = named(/^edge frontage road$/);
  check("there is a service road down the strip", apron.length >= 2, `${apron.length} carriageways`);
  const inServiceLane = blockers.filter((b) => {
    const off = Math.abs(b.z - EAST_HWY.z);
    return b.x > from && Math.abs(off - frontage) < frontageW / 2 - 0.3;
  });
  check("nothing is parked in the service road's lanes", inServiceLane.length === 0,
    inServiceLane.length ? `${inServiceLane.length} obstruction(s)` : "clear");

  // The bug this whole strip could easily have introduced: development creeping
  // into the carriageway of the widest road in the game. The running lane runs
  // out to 5 m from the centreline; nothing may be built there.
  //
  // The blockers are a different question and were got wrong first time: the
  // highway's OWN edge barrier is a line of blockers 7.2 m out, which is
  // supposed to be there — it is what stops you driving off the side. So the
  // band to test is the running lane, not the shoulder.
  const KEEP_OUT = EAST_HALF + 2;
  const inTheWay = east.filter((m) => {
    const p = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
    return p.x > EAST_HWY.x0 && Math.abs(p.z - EAST_HWY.z) < KEEP_OUT;
  });
  check("no building stands on the arterial's shoulder", inTheWay.length === 0,
    inTheWay.length ? inTheWay.slice(0, 3).map((m) => m.name).join(" ") : "clear");
  {
    const { median, lanes, laneWidth } = EAST_HWY;
    const inner = median / 2, halfRoad = lanes * laneWidth / 2;
    const lane = blockers.filter((b) => {
      const off = Math.abs(b.z - EAST_HWY.z);
      return b.x > EAST_HWY.x0 && off > inner + 0.6 && off < inner + halfRoad;
    });
    check("and nothing blocks its running lane out here either", lane.length === 0,
      lane.length ? `${lane.length} blocker(s)` : "clear");
  }

  // A strip you can only look at is a backdrop. The service road has to be
  // reachable from the city, which means a driveway off each cross street and a
  // GAP IN THE KERB where it comes through — a kerb line with no gap is a wall,
  // and it is invisible until you drive into it.
  check("there are driveways off the cross streets", named(/^edge driveway$/).length >= 4,
    `${named(/edge driveway/).length} segments`);
  for (const d of EDGE.driveways) {
    const fz = EAST_HWY.z + d.side * frontage;
    const walled = blockers.filter((b) =>
      Math.abs(b.z - fz) < frontageW && Math.abs(b.x - d.at) < frontageW / 2);
    check(`the service road is open where the driveway at x ${d.at} lands`, walled.length === 0,
      walled.length ? `${walled.length} blocker(s) across the mouth` : "open");
    // and the driveway actually spans from the street to the road
    const spans = named(/^edge driveway$/).map((m) => new THREE.Vector3().setFromMatrixPosition(m.matrixWorld));
    const reaches = spans.some((p) => Math.abs(p.z - fz) < 8);
    check(`...and reaches it`, reaches);
  }

  // THE DRAW-CALL CHECK. The edge strip is hundreds of small boxes on six
  // shared materials — exactly what merge.js's batch sweep exists for. The road
  // itself has to stay unbatched (each carriageway sets its own texture repeat),
  // so a blanket noBatch over the group is how seven hundred draw calls happen.
  const edgeGroup = scene.getObjectByName("orleafeinge:edge");
  check("the strip is grouped, so it can be batched", !!edgeGroup);
  if (edgeGroup) {
    const stripMeshes = [];
    edgeGroup.traverse((o) => { if (o.isMesh) stripMeshes.push(o); });
    const pinned = stripMeshes.filter((m) => m.userData.noBatch);
    check("...and nothing in it is pinned out of the batch",
      stripMeshes.length > 0 && pinned.length === 0,
      `${pinned.length} of ${stripMeshes.length} pinned`);
    // ...and the road did NOT get swept up in that exemption. Its carriageway
    // planes are identified by position, not by material: the strip's own
    // frontage road and verges are asphalt too, and are meant to be batched.
    const carriageway = named(/^fringe tarmac$/)
      .filter((m) => Math.abs(m.position.z - EAST_HWY.z) < EAST_HALF + 0.5);
    const roadUnpinned = carriageway.filter((m) => !m.userData.noBatch);
    check("...while the road's own tarmac is still excluded from merging",
      carriageway.length > 0 && roadUnpinned.length === 0,
      `${roadUnpinned.length} of ${carriageway.length} road plane(s) batchable`);
  }
}

// ---------------------------------------------------------------- it is wired in
{
  // The module existing is not the same as the city building it. If someone
  // drops the createOrleaFringe call from buildSet, every check above still
  // passes and the world goes back to having a cliff in it.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../src/orlearouge.js", import.meta.url), "utf8"));
  check("orlearouge builds the fringe", /fringe\s*=\s*createOrleaFringe/.test(src));
  check("...and flushes its paint into the scene", /fringe\?\.flushMarkings/.test(src));
}

console.log(failures ? `\n${failures} fringe check(s) FAILED` : "\nAll fringe checks passed");
process.exit(failures ? 1 : 0);
