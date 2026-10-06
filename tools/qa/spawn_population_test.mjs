// ---------------------------------------------------------------------------
// spawn_population_test.mjs — is anybody standing at the spawn?
//
//   node --experimental-detect-module tools/qa/spawn_population_test.mjs
//
// A human report (2026-10-03), of the free-roam start on US-167 at
// (ROAD_X, SPAWN_Z) = (-6, 130): "there is no NPCs?? I know player spawns on a
// road but theres heaps of store fronts and stuff there too but zero NPCs in
// that spot."
//
// This is measured, not asserted. population_test.mjs proves zones CAN spawn;
// it says nothing about whether the one place every player starts does. The
// spawn is the most-looked-at ground in the game and it is a highway centre
// line, which spawnzones.js classifies `highway` — a zone whose ZONE_MIX is
// deliberately null ("nobody stands on the highway").
//
// What this reports:
//   A. the zone mix at the spawn and over the whole first ring
//   B. what pick() actually returns, sampling it hundreds of times
//   C. how many land inside the 80 m you can see from the sign
//   D. which zone names are silent, and whether the spawn's own ring hits one
// ---------------------------------------------------------------------------

import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
process.on("unhandledRejection", () => {});

import { createSpawnZones } from "../../src/spawnzones.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

// main.js's own numbers. ROAD_X/SPAWN_Z are the free-roam start.
const ROAD_X = -6, ROAD_HALF = 5, LOT_X = 24, SPAWN_Z = 130;
const MAP = { minX: -2560, maxX: 2560, minZ: -2560, maxZ: 2560 };

const zones = createSpawnZones({
  MAP, ROAD_X, ROAD_HALF, LOT_X,
  getOrlea: () => null,                       // the spawn is far south of the city
  residential: [{ x: -48, z: 116, r: 24 }, { x: 48, z: 100, r: 20 }],
  extraZone: () => null,
  coreMinX: -140,
  gatherPois: [],
  worldTime: { isNight: () => false, dusk: 0 },
});

const SPAWN = { x: ROAD_X, z: SPAWN_Z };

// ---------------------------------------------------------------------------
console.log("\n--- A. what zone is the spawn, and what surrounds it ---");
const here = zones.zoneAt(SPAWN.x, SPAWN.z);
console.log(`  spawn (${SPAWN.x}, ${SPAWN.z}) classifies as "${here}"`);

// The ring as pick() actually uses it: 25..80 m.
const ringHist = {};
let inRing = 0;
for (let a = 0; a < 360; a += 2) {
  const rad = (a * Math.PI) / 180;
  for (const d of [26, 40, 55, 70, 80]) {
    const x = SPAWN.x + Math.cos(rad) * d, z = SPAWN.z + Math.sin(rad) * d;
    const zn = zones.zoneAt(x, z);
    ringHist[zn] = (ringHist[zn] || 0) + 1;
    inRing++;
  }
}
for (const [k, v] of Object.entries(ringHist).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(16)} ${((v / inRing) * 100).toFixed(1)}%`);
}

const SILENT = ["highway", "water", "building"];
const ringSilent = SILENT.filter((z) => ringHist[z]);
// This is NOT a failure on its own: the spawn is on a highway centre line with
// the causeway behind it, and those zones are SUPPOSED to be empty. What matters
// is that pick() survives them — asserted in B. Printing it here because the
// number is the reason B's retry exists, and because a silent zone suddenly
// growing across the ring would be a real regression.
console.log(`  ${((ringSilent.reduce((s, z) => s + (ringHist[z] || 0), 0) / inRing) * 100).toFixed(0)}% of the ring is deliberately silent (${ringSilent.join(", ")}) — pick() must retry past it, see B`);

// ---------------------------------------------------------------------------
console.log("\n--- B. what pick() really returns at the spawn (400 attempts) ---");
const N = 400;
let got = 0, nearest = Infinity;
const kinds = {}, zonesSeen = {}, dists = [];
for (let i = 0; i < N; i++) {
  const s = zones.pick(SPAWN, [], { minDist: 25, maxDist: 80 });
  if (!s) continue;
  got++;
  kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  zonesSeen[s.zone] = (zonesSeen[s.zone] || 0) + 1;
  const d = Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z);
  dists.push(d);
  nearest = Math.min(nearest, d);
}
dists.sort((a, b) => a - b);
const pct = (p) => (dists.length ? dists[Math.floor(dists.length * p)] : NaN);
console.log(`  returned a spot ${got}/${N} times (${((got / N) * 100).toFixed(0)}%)`);
console.log(`  distance from the spawn: min ${nearest.toFixed(1)} · median ${pct(0.5)?.toFixed(1)} · p90 ${pct(0.9)?.toFixed(1)} m`);
console.log(`  zones: ${Object.entries(zonesSeen).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`  kinds: ${Object.entries(kinds).map(([k, v]) => `${k}=${v}`).join(" ")}`);

check("pick() produces people at the spawn", got > 0, `${got}/${N}`);
check("and most land inside the ring you can actually see from the sign",
  dists.length > 0 && pct(0.9) <= 84,
  `p90 = ${pct(0.9)?.toFixed(1)} m`);
check("nothing spawns on top of the player",
  dists.length === 0 || nearest >= 24.9,
  `nearest ${nearest.toFixed(1)} m`);
// The counter is what stops this test lying by omission: a pick() that returned
// a spot on its first try every time would also pass the checks above, and so
// would one that ground through 6 retries on every single call.
// 1-in-400 exhaustion is honest randomness (a draw can land silent six times
// running), not a defect — so the bound is a rate, not zero. Before the retry
// loop this number was 116/400.
check("pick() reaches a crowd without burning its whole retry budget",
  zones.silentRingCount <= N * 0.01,
  `${zones.silentRingCount} of ${N} calls exhausted all 6 tries`);

// ---------------------------------------------------------------------------
console.log("\n--- C. the density the player will actually SEE ---");
// Ambient NPCs wander (npc.js wander disc), so count everyone whose wander
// disc can bring them inside a 60 m view cone down the road.
const VIEW = 60;
let visible = 0;
for (let i = 0; i < 200; i++) {
  const s = zones.pick(SPAWN, [], { minDist: 25, maxDist: 80 });
  if (!s) continue;
  // their wander disc is poi.r * WANDER[zone].r; approximate with the zone's own
  if (Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z) - 12 <= VIEW) visible++;
}
console.log(`  of 200 spawns, ${visible} could wander into a ${VIEW} m view (${((visible / 200) * 100).toFixed(0)}%)`);
check("the spawn view has a plausible population in it", visible / 200 > 0.15,
  `${((visible / 200) * 100).toFixed(0)}% of spawns reach the view`);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
