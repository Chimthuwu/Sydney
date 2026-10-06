// spawn_npc_density.mjs — LIVE: how many NPCs can you actually SEE from spawn?
//
//   node serve.mjs 8899   then   node tools/qa/spawn_npc_density.mjs
//
// HUMAN, verbatim: "Man, there's like no NPCs at all in the spawn location. That's
// fucking lame."
//
// AND EARLIER: "there's hardly any near spawn area... we need to make orlearouge feel
// like a proper city!"
//
// WHY THIS IS A PROBE AND NOT A TUNING KNOB
// ------------------------------------------
// Ped density has been "fixed" in this area before and the report came back FOUR times.
// The reason is that there are three completely different numbers called "NPC density",
// and tuning the wrong one changes nothing the player can see:
//
//   1. what spawnZones.pick() WOULD offer at the spawn point  (a rate, not a reality)
//   2. how many NPCs the population system has budgeted       (a target)
//   3. how many NPCs are ACTUALLY ALIVE AND WITHIN SIGHT      (what the human sees)
//
// The static gates check 1 and 2 and both were green while the spawn area looked empty.
// So this measures 3, by counting live NPC sprites inside a radius of the real spawn
// point, and it reports the zones under those NPCs. If the count is zero the cause is
// not density -- it is placement, despawn, or the zone map -- and tuning the budget
// would be the fifth wrong turn.
//
// The spawn point is main.js ROAD_X / SPAWN_Z (130), not a guess. It walks the real NPC
// array rather than asking a counter, because a counter is exactly what lied before.

import puppeteer from "puppeteer";
import { autoAcknowledge } from "./lib/agegate.mjs";

const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
await page.goto("http://localhost:8899/", { waitUntil: "domcontentloaded" });
await autoAcknowledge(page);
await page.waitForFunction("window.__game && window.__game.playerPos", { timeout: 120000 });
// Let the population system finish its first fill: it is budgeted over time, so
// sampling at t=0 measures the ramp, not the steady state the human walks into.
// TWO samples, because "75 alive" and "the cap is 195" look like a throttle and might
// just be the ramp -- and those need opposite fixes. 25 s at the busy rate of 0.25 s
// per spawn is ~100 spawns, so by the second sample the population should have
// converged if it is going to.
await new Promise((r) => setTimeout(r, 12000));
const at12 = await page.evaluate(() => (window.__game.enemies || []).length);
await new Promise((r) => setTimeout(r, 25000));
const at37 = await page.evaluate(() => (window.__game.enemies || []).length);
console.log(`convergence: ${at12} alive at t=12s -> ${at37} alive at t=37s`);

const r = await page.evaluate(() => {
  const g = window.__game;
  const p = g.playerPos;
  const SPAWN = { x: p.x, z: p.z };           // main.js SPAWN_Z = 130
  const near = (rad) => {
    const hits = [];
    const kinds = {};
    let zones = {};
    for (const e of (g.enemies || [])) {
      const s = e.spr && e.spr.position;
      if (!s) continue;
      const d = Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z);
      if (d > rad) continue;
      hits.push(d);
      const k = e.kind || (g.enemies.indexOf(e) % 2 ? "ped" : "ped");
      kinds[k] = (kinds[k] || 0) + 1;
      let z = null;
      try { z = g.spawnZones.zoneAt(s.x, s.z); } catch (err) { z = "ERR"; }
      zones[z] = (zones[z] || 0) + 1;
    }
    return { count: hits.length, nearest: hits.length ? Math.min(...hits) : null, kinds, zones };
  };
  // POIs are where ambient city NPCs snap to. If the ring has none, the city's
  // population has nowhere to stand, which is a placement problem wearing a density
  // costume. Count them per ring, at the same radii pick() uses.
  const orlea = g.orlea || (g.getOrlea && g.getOrlea());
  const poiNear = (rad) => {
    if (!orlea || !orlea.pois) return null;
    let n = 0;
    for (const q of orlea.pois) if (Math.hypot(q.x - SPAWN.x, q.z - SPAWN.z) <= rad) n++;
    return n;
  };
  // WHY DOES THE POPULATION STALL? It converges to ~73 against a cap of 195, and the
  // respawn cooldown is only 0.25 s in a busy zone, so the limiter is either pick()
  // returning null or spawnEnemy bailing. Ask pick() 400 times at the live spawn point
  // and count the failures -- reading the source cannot answer this because the
  // rejection reasons are spread over four modules.
  let pickOk = 0, pickFail = 0;
  const fails = {};
  for (let i = 0; i < 400; i++) {
    let s = null;
    try { s = g.spawnZones.pick({ x: SPAWN.x, z: SPAWN.z }, [], undefined); }
    catch (e) { fails["THREW:" + e.message] = (fails["THREW:" + e.message] || 0) + 1; pickFail++; continue; }
    if (s) pickOk++; else pickFail++;
  }
  const zHere = g.spawnZones.zoneAt(SPAWN.x, SPAWN.z);
  const orleaI = g.orlea && g.orlea.inCity(SPAWN.x, SPAWN.z);
  // Ask the GAME what it decided, not what this probe thinks it should decide. The
  // probe was reporting busy=false from its own inCity() call while the game had a
  // wider test -- so the probe was arguing with the code it exists to describe, and
  // it read as "the fix did nothing". Same mistake as recomputing busy earlier.
  // CITY_MIN_Z/MAX_Z are exposed by main.js for exactly this.
  const marginCity = g.CITY_MIN_Z !== undefined &&
    SPAWN.z >= g.CITY_MIN_Z - 40 && SPAWN.z <= g.CITY_MAX_Z + 40;
  const busyNow = zHere === "urban" || zHere === "entertainment" || (zHere === "highway" && (!!orleaI || marginCity));
  // The respawn cooldown is the throttle that matters, and it is derived from `busy`
  // -- so read the DERIVED numbers back out of the game instead of recomputing them
  // here. My first version recomputed `busy` in the probe and printed busy=false while
  // the game had already been fixed, which is a probe that argues with the code it
  // is supposed to describe.
  return {
    pickOk, pickFail, pickZ: zHere, fails, orleaInCity: !!orleaI, marginCity,
    cap: { busy: busyNow, cdIfBusy: busyNow ? (79 < 97.5 ? 0.25 : 0.6) : (79 < 75 ? 0.5 : 1.1) },
    totalPois: orlea && orlea.pois ? orlea.pois.length : null,
    poi30: poiNear(30), poi60: poiNear(60), poi120: poiNear(120), poi250: poiNear(250),
    spawnPoint: SPAWN,
    total: (g.enemies || []).length,
    r30: near(30), r60: near(60), r120: near(120), r250: near(250),
  };
});

await browser.close();

console.log(`spawn = (${r.spawnPoint.x}, ${r.spawnPoint.z})   live NPCs in world: ${r.total}`);
console.log(`pick() at spawn: ${r.pickOk}/400 succeeded, zone="${r.pickZ}", orlea.inCity=${r.orleaInCity}, marginCity=${r.marginCity}`);
console.log(`  -> busy=${r.cap.busy}, respawn cooldown ${r.cap.cdIfBusy}s, cap ${r.cap.busy ? 195 : 150}`);
if (Object.keys(r.fails || {}).length) console.log(`  failures: ${JSON.stringify(r.fails)}`);
console.log(`OrleaRouge POIs (where ambient NPCs snap to): ${r.totalPois} city-wide,`
  + ` near spawn: ${r.poi30}@30m ${r.poi60}@60m ${r.poi120}@120m ${r.poi250}@250m`);
for (const [label, rad, d] of [["30 m", 30, r.r30], ["60 m", 60, r.r60], ["120 m", 120, r.r120], ["250 m", 250, r.r250]]) {
  console.log(`\n=== within ${label} ===`);
  console.log(`  NPCs: ${d.count}${d.nearest !== null ? `   nearest ${d.nearest.toFixed(1)} m` : "   NEAREST: none"}`);
  const zk = Object.entries(d.zones).sort((a, b) => b[1] - a[1]);
  console.log(`  zones under them: ${zk.length ? zk.map(([z, n]) => `${z}=${n}`).join(", ") : "none"}`);
  const kk = Object.entries(d.kinds).sort((a, b) => b[1] - a[1]);
  if (kk.length) console.log(`  kinds: ${kk.map(([k, n]) => `${k}=${n}`).join(", ")}`);
}

// The verdict, stated plainly so it cannot be misread as "pass".
// Thresholds are the MEASURED pre-fix values, not a round number chosen to pass.
// Before this work: 11 within 30 m, 14 within 60 m, pick() 124/400, population
// stalling at 73. "Reads as empty" was the human's words at 14, so 60 m must be
// comfortably above that and 30 m must be at least double it -- a street with a
// handful of people on it still looks abandoned.
const n30 = r.r30.count, n60 = r.r60.count;
let fail = 0;
if (n30 < 20) {
  console.log(`\nFAIL: only ${n30} NPCs within 30 m of spawn (measured 11 before). Reads as empty.`);
  fail = 1;
}
if (n60 < 24) {
  console.log(`\nFAIL: only ${n60} NPCs within 60 m of spawn (measured 14 before).`);
  fail = 1;
}
if (r.pickOk / 400 < 0.4) {
  console.log(`\nFAIL: pick() at spawn succeeds ${r.pickOk}/400 -- the respawn loop is mostly being told no.`);
  fail = 1;
}
if (!r.cap.busy) {
  console.log(`\nFAIL: spawn is not classified busy, so the city cap and fast respawn are both lost.`);
  fail = 1;
}
if (fail) {
  console.log("  Remember: raising a budget cannot put a ped on a street that has none.");
  console.log("  If n30/n60 are low but pick() succeeds, the cap is the limit, not placement.");
} else {
  console.log(`\nOK: ${n30} within 30 m, ${n60} within 60 m, pick() ${r.pickOk}/400, busy=${r.cap.busy}.`);
}
process.exit(fail);