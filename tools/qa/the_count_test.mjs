// THE COUNT (theCount.js): Act Two's first mission, and the way the new towns
// are in Keseme's story at all. Played end to end against a stub cinema, so it
// runs in node without a renderer.
//
//   node --experimental-detect-module tools/qa/the_count_test.mjs
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { STOPS, TOTAL, createTheCount } from "../../src/theCount.js";

let failed = 0;
const ok = (c, m) => { console.log(`${c ? "✓ PASS" : "❌ FAIL"}: ${m}`); if (!c) failed++; };

// ---- the stops
{
  ok(STOPS.length === 13, `thirteen places (${STOPS.length})`);
  ok(new Set(STOPS.map((s) => s.id)).size === STOPS.length, "every stop has its own id");
  ok(TOTAL === STOPS.reduce((n, s) => n + s.n, 0) && TOTAL === 19456, `the total is the sum of the stops (${TOTAL})`);
  const bad = STOPS.filter((s) => !(Number.isFinite(s.x) && Number.isFinite(s.z) && s.look.length === 3 && s.beats.length >= 4 && s.n > 0 && s.company));
  ok(bad.length === 0, `every stop has a place, a camera target, a scene, a count and a company${bad.length ? ` (bad: ${bad.map((s) => s.id)})` : ""}`);
  // the ones the human asked for by name (2026-10-01): private prisons, who is in them,
  // and a plantation's land turned into a prison farm
  const all = (id) => STOPS.find((s) => s.id === id).beats.map((b) => b[1]).join(" ");
  ok(/two in three/.test(all("penitentiary")) && /one in three Black/.test(all("penitentiary")), "the penitentiary names who is inside it, against who lives in the state");
  ok(/Crown Correctional/.test(STOPS.find((s) => s.id === "penitentiary").sub) && /ninety-six percent full/.test(all("penitentiary")), "…and that a private operator is paid to keep it full");
  ok(/convict farm/.test(all("belle")) && /Same fields/.test(all("belle")), "Belle Plantation's land became the prison farm");
  ok(/BAYOU STATE INDUSTRIES/.test(all("portcalypso")) && /Two cents an hour/.test(all("pepperworks")), "the prison's labour is on the port's manifests and in the pepper fields");
  // the world only runs 21:00-04:00 (worldtime.js), so nothing here may happen in daylight
  const text = readFileSync(new URL("../../src/theCount.js", import.meta.url), "utf8");
  ok(!/\b(Morning\.|afternoon|midday|noon|in the sun)\b/i.test(text), "no scene is set in daylight, in a night-only world");
}

// ---- the original script is not touched by any of this
{
  let same = null;
  try {
    execSync("git diff --quiet 0edb70d HEAD -- src/nolantis.js src/welcomeback.js src/bluelight.js src/alternateCampaign.js", { stdio: "ignore" });
    execSync("git diff --quiet -- src/nolantis.js src/welcomeback.js src/bluelight.js src/alternateCampaign.js", { stdio: "ignore" });
    same = true;
  } catch (e) { same = e.status === 1 ? false : null; }
  if (same === null) console.log("  -- skipped: no git history to compare the original script against");
  else ok(same, "nolantis, welcomeback, bluelight and alternateCampaign are still byte-for-byte \"update 11\"");
}

// ---- main.js starts it from the end of Act One, and shows its waypoint
{
  const src = readFileSync(new URL("../../src/main.js", import.meta.url), "utf8");
  ok(/import \{ createTheCount \} from "\.\/theCount\.js";/.test(src), "main.js imports it");
  ok(/klan\.nightRideOnMamas\(\(\) => \{ if \(onDone\) onDone\(\); if \(theCount\) theCount\.start\(\); \}\)/.test(src), "the night ride's end starts it");
  ok(/\(theCount && theCount\.waypoint\)/.test(src), "its waypoint reaches the minimap");
  ok(/if \(theCount\) theCount\.update\(dt\);/.test(src), "it is updated every frame");
}

// ---- played through
{
  const log = { cards: [], said: [], captions: [], objective: null, flashes: [] };
  const api = {
    letterbox() {}, async black() {}, async wait() {}, shot() { return Promise.resolve(); },
    async card(k, big, sub) { log.cards.push([k, big, sub]); },
    async say(who, text) { log.said.push([who, text]); },
    async caption(text) { log.captions.push(text); },
  };
  const cine = { scene: (fn) => Promise.resolve().then(() => fn(api)) };
  const state = { cinematic: false, veh: null };
  const playerPos = { x: 0, z: 0, set(x, y, z) { this.x = x; this.z = z; } };
  let exits = 0;
  const T = createTheCount({
    cine, state, playerPos,
    setObjective: (t) => { log.objective = t; },
    flashObjective: (t) => log.flashes.push(t),
    exitVehicle: () => { exits++; },
  });
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

  ok(T.phase === "idle" && T.waypoint === null, "it waits for Act One to end");
  T.update(0.016);
  ok(T.phase === "idle", "and does nothing on its own");
  ok(T.start() === true, "start() opens it");
  ok(T.start() === false, "and a second start() does not replay it");
  await settle();
  ok(T.phase === "count", "the opening hands over to the count");
  ok(log.cards.some(([k, b]) => k === "MISSION" && b === "THE COUNT"), "with the MISSION card");
  ok(log.said.some(([w]) => w === "EMIKO"), "and Emiko in it");

  const order = [];
  for (let guard = 0; guard < 40 && T.phase === "count"; guard++) {
    const wp = T.waypoint;
    // the waypoint is the NEAREST place not yet counted
    const left = STOPS.filter((s) => !T.counted.includes(s.id));
    const near = left.reduce((a, s) => (Math.hypot(s.x - playerPos.x, s.z - playerPos.z) < Math.hypot(a.x - playerPos.x, a.z - playerPos.z) ? s : a));
    if (wp.x !== near.x || wp.z !== near.z) { ok(false, `the waypoint is the nearest stop (got ${wp.x},${wp.z}, nearest ${near.id})`); break; }
    playerPos.set(wp.x + 3, 0, wp.z - 2);
    T.update(0.016);
    ok(state.cinematic && T.busy, `${near.id}: arriving starts its scene, with the world held`);
    T.update(0.016);
    await settle();
    order.push(near.id);
    ok(!state.cinematic && T.counted.includes(near.id), `${near.id}: counted, and control is handed back`);
  }
  ok(order.length === STOPS.length, `every place was counted once (${order.length})`);
  ok(T.total === TOTAL, `the running total is ${TOTAL} (${T.total})`);
  for (const s of STOPS) ok(log.cards.some(([k, b, sub]) => k === "EXT." && b === s.place && sub === s.sub), `${s.place} gets its EXT. card`);
  ok(log.cards.filter(([k]) => k === "THE COUNT").length === STOPS.length, "a tally card after every place");
  ok(/13 \/ 13 places/.test(log.cards.filter(([k]) => k === "THE COUNT").pop()[2]), "the last tally reads 13 / 13");

  ok(T.phase === "report", "then it sends her to Solange");
  ok(T.waypoint && T.waypoint.x === -26, "the waypoint is Solange's corner");
  playerPos.set(-26, 0, 254.5); T.update(0.016); await settle();
  ok(log.said.some(([w, t]) => w === "KESEME" && t === "Nineteen thousand four hundred and fifty-six."), "Keseme says the number, and it is the total");
  ok(log.said.some(([w, t]) => w === "SOLANGE" && /Cloudline Tower, forty-fourth floor/.test(t)), "Solange finds the one address");
  ok(T.phase === "address" && T.waypoint.x === -55, "and the radar points at it");
  playerPos.set(-55, 0, -400); T.update(0.016); await settle();
  ok(T.phase === "done" && T.waypoint === null, "the lobby closes the mission");
  ok(/To be continued/.test(log.flashes.pop()), "on step two, left open");
  ok(exits >= STOPS.length + 3, "every scene gets her out of the car first");
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll The Count checks passed");
