// ---------------------------------------------------------------------------
// population_test.mjs — is anybody actually out there?
//
//   node --experimental-detect-module tools/qa/population_test.mjs
//
// A human report (2026-09-28): "nearly ALL the old NPCs are gone now" — and
// nothing to fight at all on the streets. An empty world is the worst kind of
// bug because every individual system still reports healthy: the cap is not
// exceeded, nothing has thrown, and the districts all built.
//
// Two real causes, both silent:
//
//   * `pick()` used to `return null` when no POI was inside the spawn ring. The
//     Crown Strip and the new east arterial have ZERO POIs at any distance, so
//     standing on either meant the tick could never produce a person. One missed
//     ring was a hard stop, forever.
//
//   * ENEMY_CAP was 48 when the state was a fifth of its present size. The map
//     was then made 5x larger and OrleaRouge doubled, and the cap was never
//     revisited: 8 people per km2, of which you only ever saw those inside a
//     160 m ring.
//
// The test samples the state's real zone classification over a grid, so a
// district that starts answering with a word nobody has a crowd for turns this
// red instead of quietly becoming a field.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { surface } from "../../src/graphics.js";
const characters = await import("../../src/characters.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const noop = () => {};
const scene = new THREE.Scene();
const ctx = new Proxy({
  scene, surface, addBlocker: noop, addLitSpot: noop, poolLight: noop, flashObjective: noop,
  addService: noop, makeBillboard: noop, makeFence: noop, makeBarrel: noop, makePallet: noop,
  makeNeonSign: () => new THREE.MeshStandardMaterial({ color: 0xff4fb3 }),
  roadMaterial: () => new THREE.MeshStandardMaterial({ color: 0x2b2b30 }),
  getSheriffProto: () => ({}), lots: [], services: [], pois: [], props: [],
  makeHoodrat: (o) => characters.makeHoodrat(o),
  playerPos: new THREE.Vector3(0, 0, 300),
  worldTime: { isNight: () => false, hour: () => 12 },
  document: globalThis.document, window: globalThis,
  resolveCollision: (_c, n) => n,
  loadDsCar: () => new Promise(() => {}), loadGLB: () => new Promise(() => {}),
  loadModel: () => new Promise(() => {}), loadVehicle: () => new Promise(() => {}),
}, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k === "string" && /(lots|services|pois|props|occluders|blockers|lanes|people|actors)$/.test(k)) return [];
    return noop;
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

// main.js builds these in this order and hands them to extraZone in this order
const D = [
  ["orlea", "../../src/orlearouge.js", "createOrleaRouge"],
  ["metro", "../../src/metro.js", "createMetro"],
  ["crown", "../../src/crownstrip.js", "createCrownStrip"],
  ["west", "../../src/westparish.js", "createWestParish"],
  ["east", "../../src/eastbank.js", "createEastBank"],
  ["tus", "../../src/tusouxroe.js", "createTusouxroe"],
  ["chat", "../../src/chatboro.js", "createChatboro"],
  ["shruston", "../../src/shruston.js", "createShruston"],
  ["chars", "../../src/charsoufre.js", "createCharsoufre"],
  ["state", "../../src/stateWorld.js", "createStateWorld"],
];
const d = {};
for (const [k, p, fn] of D) d[k] = (await import(p))[fn](ctx);
ctx.otherLanes = () => [];
d.state.buildSet();

const { ZONE_MIX, createSpawnZones, WANDER } = await import("../../src/spawnzones.js");
const { STATE_BOUNDS } = await import("../../src/stateWorld.js");

const extraZone = (x, z) =>
  d.state.zoneAt(x, z) || d.tus.zoneAt(x, z) || d.chat.zoneAt(x, z) ||
  d.shruston.zoneAt(x, z) || d.chars.zoneAt(x, z) || d.metro.zoneAt(x, z) ||
  d.crown.zoneAt(x, z) || d.west.zoneAt(x, z) || d.east.zoneAt(x, z) || null;

const ROAD_X = -6, ROAD_HALF = 5, LOT_X = 120;
const residential = [{ x: -48, z: 116, r: 24 }, { x: 48, z: 100, r: 20 }];
const gatherPois = d.east.zoneRects
  ? d.east.zoneRects.filter(([n]) => n === "market_row")
    .map(([, r]) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, r: Math.min(r.x1 - r.x0, r.z1 - r.z0) / 4 }))
  : [];

const zones = createSpawnZones({
  MAP: STATE_BOUNDS, ROAD_X, ROAD_HALF, LOT_X,
  getOrlea: () => d.orlea, residential, extraZone,
  coreMinX: -STATE_BOUNDS.maxX - 4, gatherPois, worldTime: { isNight: () => false, dusk: 0 },
});

// ---------------------------------------------------------------- the ring
// The second half of "nearly ALL the old NPCs are gone": even when a spawn
// SUCCEEDS, how far away is it? This was 65–105 m for the life of pick(), so
// downtown measured 7 people inside the 50 m you can actually see (human
// report, 2026-09-28, screenshot of an empty boulevard: "hardly any NPCs
// appearing at all ... hardly any traffic or pedestrians"). Nothing was
// failing — 4000/4000 attempts returned a spot. They were just never near.
{
  const CITY = d.orlea.grid.city;
  const focus = { x: (CITY.minX + CITY.maxX) / 2, z: (CITY.minZ + CITY.maxZ) / 2 };
  const N = 4000, RING_MIN = 25;
  const dists = [];
  let nulls = 0;
  for (let i = 0; i < N; i++) {
    const s = zones.pick(focus, [], {});
    if (!s) { nulls++; continue; }
    dists.push(Math.hypot(s.x - focus.x, s.z - focus.z));
  }
  dists.sort((a, b) => a - b);
  const at = (p) => dists[Math.floor(dists.length * p)];

  check("downtown spawns actually succeed", nulls / N < 0.05,
    `${N - nulls}/${N} returned a spot`);
  check("nobody is ever placed inside the ring", dists[0] >= RING_MIN - 0.01,
    `closest spawn ${dists[0].toFixed(1)} m against a ${RING_MIN} m ring`);
  check("the bulk of the crowd is on your block, not a ring you can see over",
    at(0.5) < 60, `median ${at(0.5).toFixed(1)} m, p90 ${at(0.9).toFixed(1)} m`);

  // The number the report is actually about: how many people are inside the
  // radius you can see, given the cap and the annulus they live in. Read the
  // real caps out of main.js rather than repeating them here — they were
  // hardcoded at 90/30 and silently under-reported the street after the 2026-10-01
  // raise, which is the same class of bug the file exists to catch.
  const msrc = fs.readFileSync(new URL("../../src/main.js", import.meta.url), "utf8");
  const capN = Number((msrc.match(/const ENEMY_CAP\s*=\s*(\d+)/) || [])[1]);
  const busyN = Number((msrc.match(/const ENEMY_CAP_BUSY\s*=\s*(\d+)/) || [])[1]);
  const cullN = Number((msrc.match(/const CIV_CULL\s*=\s*(\d+)/) || [])[1]);
  const cap = capN + busyN;
  const inner = dists[0], outer = at(0.999);
  // the annulus people are spread across is the cull ring, not the spawn ring
  const annulus = Math.PI * Math.min(cullN, outer) ** 2;
  const seen = cap * (Math.PI * Math.min(50, outer) ** 2 - Math.PI * Math.min(50, inner) ** 2) / annulus;
  check("downtown reads as a populated street, not an abandoned one", seen >= 20,
    `${seen.toFixed(1)} people expected within 50 m (cap ${cap}, cull ${cullN} m; was 7.1 before the ring was fixed)`);

  // ...and the wander disc has to be big enough that they MOVE. A 6 m POI at
  // urban r 0.55 was a 3 m disc: a person who spawns once and stands on it.
  const wz = WANDER.urban;
  const medPoiR = 6;
  check("urban pedestrians wander their block instead of standing still",
    medPoiR * wz.r >= 5, `median POI ${medPoiR} m x urban r ${wz.r} = ${(medPoiR * wz.r).toFixed(1)} m of movement`);
}

// ---------------------------------------------------------------- the vocabulary
{
  // THE DELIBERATE EMPTIES. These have no mix ON PURPOSE and must keep having
  // none: composer.zoneAt() returns "building" so that nobody spawns inside
  // walls, and the highway and the bayou are not places people stand. Listing
  // them here is the point — if a future change gives one of them a crowd, this
  // test says so rather than letting it pass unnoticed.
  const DELIBERATE = new Set(["building", "water", "highway"]);
  for (const z of DELIBERATE) {
    check(`"${z}" is still a deliberately empty zone`, ZONE_MIX[z] === null || ZONE_MIX[z] === undefined,
      ZONE_MIX[z] === undefined ? "no entry (expected)" : JSON.stringify(ZONE_MIX[z]));
  }

  // Everything else the world can answer with must HAVE a crowd. This is the
  // check that catches a composer's internal vocabulary leaking into the spawn
  // table — the failure mode where a whole district silently becomes a field.
  const S = 40, LO = STATE_BOUNDS.minX, HI = STATE_BOUNDS.maxX;
  const tally = new Map();
  const orphans = new Map();
  for (let gz = LO; gz < HI; gz += S) for (let gx = LO; gx < HI; gx += S) {
    const z = zones.zoneAt(gx, gz);
    tally.set(z, (tally.get(z) || 0) + 1);
    if (!ZONE_MIX[z] && !DELIBERATE.has(z)) orphans.set(z, (orphans.get(z) || 0) + 1);
  }
  check("no zone name in the world is missing a crowd",
    orphans.size === 0,
    orphans.size ? [...orphans].map(([z, n]) => `${z} (${n} cells)`).join(", ") : "every zone resolves");

  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  const live = [...tally].filter(([z]) => ZONE_MIX[z] && Object.entries(ZONE_MIX[z]).some(([k]) => k !== "border"))
    .reduce((a, [, n]) => a + n, 0);
  check("most of the state can have people on it", live / total > 0.7,
    `${((live / total) * 100).toFixed(0)}% spawnable`);
}

// ---------------------------------------------------------------- pick() must not give up
{
  // The regression, in the form the player meets it: stand somewhere with no
  // POI in range and try to spawn somebody. Used to return null, always.
  const places = [
    ["the Crown Strip", 60, 10],
    ["the east arterial", 900, 348],
    ["downtown", 92, 310],
    ["the French Quarter", -66, 270],
    ["Port Calypso", 700, -800],
    ["Oyster Bay", 700, 700],
    ["Red Dust", -700, -700],
    ["the woods", 300, 800],
  ];
  for (const [label, x, z] of places) {
    let got = 0;
    for (let i = 0; i < 40; i++) if (zones.pick({ x, z }, [], { minDist: 20, maxDist: 90 })) got++;
    check(`people can spawn at ${label}`, got > 0, `${got}/40 attempts returned a spot`);
  }
}

// ---------------------------------------------------------------- the caps
{
  // main.js cannot be imported headlessly (it is the game), so the caps are read
  // out of its source — and the read FAILS LOUDLY if a refactor moves them,
  // rather than quietly passing a check it is no longer making.
  const src = fs.readFileSync(new URL("../../src/main.js", import.meta.url), "utf8");
  const cap = src.match(/const ENEMY_CAP\s*=\s*(\d+)/);
  const busy = src.match(/const ENEMY_CAP_BUSY\s*=\s*(\d+)/);
  const cull = src.match(/const CIV_CULL\s*=\s*(\d+)/);
  check("main.js still declares ENEMY_CAP where this test expects it", !!cap);
  check("...and ENEMY_CAP_BUSY", !!busy);
  check("...and CIV_CULL", !!cull);
  if (cap) {
    const n = Number(cap[1]);
    // 48 was the cap when the state was a fifth this size. Raised to 90 as a
    // measured hedge, then to 150 on 2026-10-01 ("there used to be a lot of
    // NPCs, now there's hardly any") once the pick()-returns-null bug that the
    // 90 hedge was compensating for had been fixed for real.
    check("the population cap has not been left behind by the map growing again", n >= 140, `${n} ambient NPCs`);
  }
  if (busy) check("...and the downtown bonus is a named constant, not a literal", Number(busy[1]) > 0, `+${busy[1]} downtown`);
  if (cull) {
    const n = Number(cull[1]);
    check("the cull ring is wide enough to see down a street", n >= 220, `${n} m`);
  }
  if (cap && cull) {
    const area = Math.PI * Math.pow(Number(cull[1]) / 1000, 2);
    const n = Number(cap[1]) + Number(busy ? busy[1] : 0);
    // For reference, the old setting (48 + 26 inside 160 m) was ~920/km2 — a
    // crowded street, not an empty one. Anything in this band is plausible
    // ambient density; past 1400 you are paying draw calls for a mob.
    const d = n / area;
    check("...which is a street's worth of density, not a mob",
      d > 400 && d < 1400, `${Math.round(d)} people per km2 downtown`);
  }
}

console.log(failures ? `\n${failures} population check(s) FAILED` : "\nAll population checks passed");
process.exit(failures ? 1 : 0);
