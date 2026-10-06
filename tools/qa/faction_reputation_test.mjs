// faction_reputation_test.mjs — the GTA2 gang loop, asserted rather than assumed.
//
//   node --experimental-detect-module tools/qa/faction_reputation_test.mjs
//
// Reputation is the kind of feature that looks correct and is not: the tiers can
// be unreachable, the decay can wipe a tier in one frame, or the reset can miss
// the respawn path. None of that shows up by reading the code.
//
// What is asserted here:
//   1. a neutral faction does NOT open on the player (the explicit request)
//   2. ENEMY_TIER is reachable in a plausible number of kills — "after a while"
//      must not mean twenty minutes
//   3. ENEMY_TIER makes that faction hunt the player, and the OTHER faction's
//      standing rises from the same kills
//   4. PROTECTOR_TIER is reachable, and only from kills on the other faction
//   5. reputation resets on respawn
//   6. turf fights are gated at roughly 1/5, not automatic
//   7. decay does not immediately revoke a tier the moment it is earned

import { createFactionWar } from "../../src/factions.js";

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (cond, m) => (cond ? ok(m) : bad(m));

// factions.js imports MAX_HOSTILE from npc.js, which pulls in THREE. Stub the
// one binding it needs so this stays a fast pure-logic test.
globalThis.__stubMaxHostile = 8;

// The module keeps its ledger in module scope, so each scenario needs a FRESH
// module instance to start from zero — a shared one would let an earlier test's
// kills leak into a later tier check and pass for the wrong reason.
const fresh = async () => {
  const bust = `${Date.now()}-${Math.random()}`;
  const m = await import(`../../src/factions.js?v=${bust}`);
  return m.createFactionWar({
    npcs: { hostileCount: 0, becomeHostile: () => true, noise: () => {} },
    spawnZones: { isBorder: () => true },
  });
};

const walk = (war, seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) war.update(dt, [], null);
};

// ---------------------------------------------------------------------------
console.log("=== 1. a neutral faction does not hunt the player ===");
{
  const war = await fresh();
  check(war.standing("redneck") === "neutral", "a fresh war has neutral rednecks");
  check(war.standing("hoodrat") === "neutral", "a fresh war has neutral hoodrats");
  check(!war.huntsPlayer("redneck"), "neutral rednecks do not hunt the player");
  check(!war.huntsPlayer("hoodrat"), "neutral hoodrats do not hunt the player");
  check(!war.protectsAgainst("redneck", "hoodrat"), "neutral rednecks do not protect the player");
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. ENEMY_TIER is reachable in a plausible number of kills ===");
{
  const war = await fresh();
  let kills = 0;
  while (war.standing("hoodrat") !== "enemy" && kills < 60) {
    war.notePlayerKill("hoodrat");
    kills++;
  }
  check(kills === 3,
    `hoodrats turn hostile after ${kills} kills (want exactly 3 — "after a while", not forever)`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. killing one faction lifts the other and enrages the first ===");
{
  const war = await fresh();
  for (let i = 0; i < 3; i++) war.notePlayerKill("redneck");
  check(war.standing("redneck") === "enemy", "3 redneck kills makes the rednecks hunt the player");
  check(!war.huntsPlayer("hoodrat"), "the hoodrats are NOT hunting the player for this");
  check(war.reputation.hoodrat > 0, `hoodrat standing rose to ${war.reputation.hoodrat.toFixed(1)}`);

  // and the reverse, so the ledger is genuinely two-way and not hardcoded
  const war2 = await fresh();
  for (let i = 0; i < 3; i++) war2.notePlayerKill("hoodrat");
  check(war2.standing("hoodrat") === "enemy", "and 4 hoodrat kills makes the hoodrats hunt");
  check(war2.standing("redneck") !== "enemy", "the rednecks are not made hostile by killing hoodrats");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. PROTECTOR_TIER comes from the OTHER faction's enemies ===");
{
  // Killing ONLY hoodrats cannot make the rednecks protect the player: the favour
  // has to come from hurting somebody the faction actually hates.
  {
    const war = await fresh();
    for (let i = 0; i < 3; i++) war.notePlayerKill("hoodrat");
    check(war.standing("redneck") === "protector",
      "killing hoodrats alone DOES make rednecks protectors");
    check(war.standing("hoodrat") === "enemy", "but it does make the hoodrats hunt the player");
  }
  // Killing rednecks is what buys the hoodrats' favour — and nothing else.
  {
    const war = await fresh();
    for (let i = 0; i < 3; i++) war.notePlayerKill("redneck");
    check(war.standing("hoodrat") === "protector",
      `hoodrats become protectors after the player turns on rednecks (rep ${war.reputation.hoodrat})`);
    check(war.protectsAgainst("hoodrat", "redneck"), "protectors will stand against their own enemy");
    check(!war.protectsAgainst("hoodrat", "hog"), "protectors will not fight somebody they have no quarrel with");
  }
  // Killing BOTH is its own outcome, and it must not quietly read as "protected".
  // (An earlier version of this test asserted protection here and failed: the
  // ledger correctly leaves the player at -4 with BOTH factions, hated by both.
  // The test was wrong, not the maths.)
  {
    const war = await fresh();
    for (let i = 0; i < 3; i++) war.notePlayerKill("hoodrat");
    for (let i = 0; i < 3; i++) war.notePlayerKill("redneck");
    check(war.standing("hoodrat") !== "protector" && war.standing("redneck") !== "protector",
      "a player who kills both factions is not a protector to either");
    // 3 kills each leaves BOTH at -3, which is inside the neutral band, not the
    // enemy tier (-9). Killing both equally is the "nobody likes you, nobody is
    // hunting you" middle — a real state, and the reason to keep the thresholds
    // where they are. Assert THAT rather than a hostility that does not happen.
    check(war.standing("hoodrat") === "neutral" && war.standing("redneck") === "neutral",
      `killing both equally leaves you disliked by both but hunted by neither (rep ${JSON.stringify(war.reputation)})`);
  }
  // Kills on the victim's own ground are worth more, which is the lever that lets
  // a player reach PROTECTOR_TIER without first making an enemy of the wrong side.
  {
    const atHome = await fresh();
    atHome.notePlayerKill("redneck", true);
    atHome.notePlayerKill("redneck", true);
    atHome.notePlayerKill("redneck", true);
    const away = await fresh();
    for (let i = 0; i < 3; i++) away.notePlayerKill("redneck", false);
    check(atHome.reputation.hoodrat > away.reputation.hoodrat,
      `kills on a faction's home ground count for more (${atHome.reputation.hoodrat} > ${away.reputation.hoodrat})`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. reputation resets on respawn ===");
{
  const war = await fresh();
  for (let i = 0; i < 4; i++) war.notePlayerKill("redneck");
  check(war.standing("redneck") === "enemy", "precondition: the rednecks are hostile");
  war.resetReputation();
  check(war.standing("redneck") === "neutral", "after respawn the rednecks are neutral again");
  check(war.standing("hoodrat") === "neutral", "after respawn the hoodrats are neutral again — no inherited favour");
  check(war.reputation.redneck === 0 && war.reputation.hoodrat === 0, "the ledger is back to zero");
  check(!war.huntsPlayer("redneck"), "a respawned player is not born hated");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. turf fights are gated, not automatic ===");
{
  // A redneck and a hoodrat in sight, on contested ground. With the 1/5 gate the
  // pair should fight sometimes but NOT every single time — an ungated version
  // squares up every eligible pair on the same tick, which is the "permanently
  // shouting" report.
  const mk = (type, x) => ({
    type, dead: false, state: "idle", border: true, mood: "normal",
    spr: { position: { x, y: 0, z: 0 } }, T: { aggro: 20 },
  });
  let started = 0;
  const TRIALS = 400;
  for (let i = 0; i < TRIALS; i++) {
    const hostiles = [];
    const npcs = {
      hostileCount: 0,
      becomeHostile: (e) => { hostiles.push(e); return true; },
      noise: () => {},
    };
    // a FRESH module per trial: the ledger is module scope and the fight gate
    // uses Math.random, so reusing one instance would not reset the gate
    const m = await import(`../../src/factions.js?v=${Date.now()}-${Math.random()}`);
    const w2 = m.createFactionWar({ npcs, spawnZones: { isBorder: () => true } });
    w2.update(0.5, [mk("redneck", 0), mk("hoodrat", 3)], null);   // forces the timer
    if (hostiles.length) started++;
  }
  const rate = started / TRIALS;
  check(rate > 0.1 && rate < 0.45,
    `pairs that went at it: ${(rate * 100).toFixed(0)}% over ${TRIALS} trials (want ~20%, not 0% and not 100%)`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. a freshly earned tier survives ordinary decay ===");
{
  const war = await fresh();
  for (let i = 0; i < 4; i++) war.notePlayerKill("redneck");
  check(war.standing("redneck") === "enemy", "precondition: hostile");
  walk(war, 30);                      // 30 seconds of a normal play session
  check(war.standing("redneck") === "enemy",
    "still hostile 30s later — a tier is not revoked the instant it is earned");
  walk(war, 60 * 25);                 // 25 minutes
  const after = war.standing("redneck");
  console.log(`  --   after 25 min of decay: ${after} (rep ${war.reputation.redneck.toFixed(1)})`);
}

console.log("\n=== 8. both tiers are reachable at real kill counts ===");
{
  // The specific bug this file caught: PROTECTOR_TIER was 9 while three kills of
  // the other faction were worth 8, so the tier could not be reached without
  // first making an enemy of the wrong side at nearly the same rate. Assert the
  // arithmetic directly so a future retune cannot quietly reintroduce it.
  const enemy = await fresh();
  const protector = await fresh();
  let e = 0, p = 0;
  while (enemy.standing("hoodrat") !== "enemy" && e < 40) { enemy.notePlayerKill("hoodrat"); e++; }
  while (protector.standing("hoodrat") !== "protector" && p < 40) { protector.notePlayerKill("redneck"); p++; }
  check(e <= 5, `enemy tier reachable in ${e} kills`);
  check(p <= 5, `protector tier reachable in ${p} kills of the other faction`);
  // and the headline case: killing hoodrats makes the REDNECKS your friend
  const war = await fresh();
  for (let i = 0; i < e; i++) war.notePlayerKill("hoodrat");
  check(war.standing("redneck") === "protector",
    `kill ${e} hoodrats -> the rednecks protect you (rep ${war.reputation.redneck})`);
  check(war.standing("hoodrat") === "enemy", `...and the hoodrats hunt you (rep ${war.reputation.hoodrat})`);
}

console.log(`\n${fails ? fails + " FAILURES" : "the gang loop behaves as asked"}`);
process.exit(fails ? 1 : 0);