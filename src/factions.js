// ---------------------------------------------------------------------------
// factions.js — Redneck vs Hoodrat territorial warfare.
//
// Rednecks and Hoodrats hold their own territory and ignore each other inside it,
// but in border/crossover zones, a Redneck and a Hoodrat that spot each other
// engage in turf battles without requiring player intervention.
//
// Fights only start near the player (nobody sees one across the parish, and a
// far fight would hold hostile slots), and they never take the last slots of
// MAX_HOSTILE: those stay free for NPCs the player provokes.
// ---------------------------------------------------------------------------

import { MAX_HOSTILE } from "./npc.js";

// Who will fight whom on sight. Rednecks and Hoodrats have always been the
// pair; klansmen (klan.js) are the third, and the asymmetry is the point —
// Hoodrats square up to them, Rednecks do not, because in this parish those are
// the same people with the hoods off. A klansman only exists during a set
// piece, so this costs nothing the rest of the time.
const ENEMIES_OF = {
  redneck: new Set(["hoodrat"]),
  hoodrat: new Set(["redneck", "klansman"]),
  // Mally and Bubba (klan.js) exist only inside the night ride, so listing them
  // costs nothing the rest of the time — but it means a klansman who finishes
  // with Keseme turns on whoever is next instead of queueing politely for her.
  klansman: new Set(["hoodrat", "mally", "bubba"]),
  mally:    new Set(["klansman"]),
  bubba:    new Set(["klansman"]),
};
const FIGHTERS = new Set(Object.keys(ENEMIES_OF));

// ---------------------------------------------------------------------------
// REPUTATION (human request, 2026-10-02)
//
// "the rednecks and hoodrats shouldn't be hostile by default... only if we attack
// em first... if the player continues to kill the Hoodrats OR the rednecks they
// eventually become infamous making the opposite faction favor and protect the
// player, but the faction that the player has been killing after a while will
// ALWAYS attack player... This is kinda like how in GTA2 the gangs work."
//
// So each faction keeps a standing score with the player, and it cuts BOTH ways:
//
//   Kills the player has made      -> that faction's score drops. It is becoming
//                                     infamous with them. Past ENEMY_TIER the
//                                     whole faction knows the player's face:
//                                     they attack on sight, no provocation
//                                     needed, and they call the others in.
//   Kills the OTHER faction has    -> this faction's score RISES. They start
//                                     counting the player as their own.
//   At PROTECTOR_TIER or better     -> they will not only spare the player, they
//                                     will stand between them and a rival.
//                                     Attacking a protected player is a big
//                                     reputational loss for whoever does it.
//
// The scores are separate per faction, which is what makes the middle of the
// range interesting: nobody has to be neutral, and a player who has been
// killing both is a known quantity to both rather than a nobody to one.
//
// These are DELIBERATELY not symmetric in effect. ENEMY_TIER is reachable in
// about four or five kills, because "after a while" should not mean twenty
// minutes. PROTECTOR_TIER needs the player to have made the other faction's
// enemies worse for them, and it DECAYS slowly, so standing with a faction is
// something you maintain rather than something you unlock once.
const REPUTATION = { redneck: 0, hoodrat: 0 };

// Below -ENEMY_TIER: the faction is hunting the player. The reputation a kill
// against THEM gives the other faction.
const ENEMY_TIER = 9;         // per-kill cost is 3, so three kills
const PROTECTOR_TIER = 6;     // net favour needed before they take your side (3 kills)
const DECAY_PER_MIN = 0.6;     // standing creeps back toward neutral

// How much the player's victims are worth to their enemies. Kills in the other
// faction's territory count double — doing them a favour on their own ground is
// how a reputation is really made in this parish.
const FAVOUR_PER_KILL = 2;
const FAVOUR_ON_HOME_GROUND = 4;

const SIGHT_RANGE = 22;
const SIGHT_RANGE_SQ = SIGHT_RANGE * SIGHT_RANGE;
const WATCH_RANGE = 60;       // just past npc.js's NEAR level of detail
const PLAYER_SLOTS = 2;
// Odds that a rival pair who have spotted each other actually go at it. See the
// note at the call site — this is what turns a turf war into an occasional event.
const FIGHT_CHANCE = 0.2;       // hostile slots turf fights leave for the player

/**
 * @param {object} o
 * @param {object} o.npcs        the NPC system instance from createNpcSystem
 * @param {object} o.spawnZones  spawnZones instance (its isBorder check); without it, `e.border`
 */
export function createFactionWar({ npcs, spawnZones = null } = {}) {
  let timer = Math.random() * 0.3;
  const candidates = [];
  const engaged = [];       // klansmen already fighting: targetable, never instigators
  let decayCd = 0;

  // --- reputation -----------------------------------------------------------
  // The only faction the player can gain standing with is the one whose enemies
  // they have been hurting, so this is a two-way ledger over the pair.
  const OTHER = { redneck: "hoodrat", hoodrat: "redneck" };

  /**
   * The player killed one of `victimType`. That hurts the victim's own faction
   * and helps its opponent.
   * @param {string} victimType  the NPC that died
   * @param {boolean} onHomeGround  true if it died in its own territory
   */
  function notePlayerKill(victimType, onHomeGround = false) {
    const foe = OTHER[victimType];
    if (!foe) return null;      // a hog or a hobo has no gang politics
    REPUTATION[victimType] -= 3;
    REPUTATION[foe] += onHomeGround ? FAVOUR_ON_HOME_GROUND : FAVOUR_PER_KILL;

    // These flags exist ONLY to announce a tier crossing once. They deliberately
    // do not decide behaviour — standing() reads the score.
    let flash = null;
    if (REPUTATION[victimType] <= -ENEMY_TIER && !ENEMY_FLAG[victimType]) {
      ENEMY_FLAG[victimType] = true;
      flash = { kind: "enemy", faction: victimType };
    }
    if (REPUTATION[foe] >= PROTECTOR_TIER && !PROTECTOR_FLAG[foe]) {
      PROTECTOR_FLAG[foe] = true;
      flash = { kind: "protector", faction: foe };
    }
    return flash;
  }

  // Set once a tier is reached, so it is announced once rather than every kill.
  const ENEMY_FLAG = { redneck: false, hoodrat: false };
  const PROTECTOR_FLAG = { redneck: false, hoodrat: false };

  /**
   * Wipe the ledger. Called on respawn: standing is per-life, not per-save, so a
   * new player starts neutral with both factions instead of inheriting a grudge
   * from a character nobody in this parish has met.
   */
  function resetReputation() {
    for (const f of Object.keys(REPUTATION)) REPUTATION[f] = 0;
    ENEMY_FLAG.redneck = ENEMY_FLAG.hoodrat = false;
    PROTECTOR_FLAG.redneck = PROTECTOR_FLAG.hoodrat = false;
  }

  /**
   * How this faction should treat the player right now.
   * @returns {"enemy"|"protector"|"neutral"}
   */
  function standing(faction) {
    // Derived from the score, NEVER from the flags. The flags are sticky so a
    // tier is announced once, and reading them here made standing() lie: after 3
    // hoodrat kills then 3 redneck kills the ledger is -3/-3 — disliked by both,
    // hunted by neither — while the flags still said protector/enemy from the
    // earlier kills. Behaviour has to follow the number.
    if (REPUTATION[faction] <= -ENEMY_TIER) return "enemy";
    if (REPUTATION[faction] >= PROTECTOR_TIER) return "protector";
    return "neutral";
  }

  /**
   * Whether a member of `faction` would open on the player with no provocation.
   * Only the ENEMY tier does — a protector is the opposite, and neutral members
   * stay civilians-until-provoked as they always have.
   */
  const huntsPlayer = (faction) => standing(faction) === "enemy";

  /**
   * Whether a member of `faction` will come to the player's aid against `foeType`.
   * Protectors only, and only against their own declared enemy — a protector
   * does not help against somebody their faction has no quarrel with.
   */
  const protectsAgainst = (faction, foeType) =>
    standing(faction) === "protector" && ENEMIES_OF[faction]?.has(foeType);

  function tickDecay(dt) {
    decayCd -= dt;
    if (decayCd > 0) return;
    decayCd = 1;
    for (const f of Object.keys(REPUTATION)) {
      const before = REPUTATION[f];
      if (before > 0) REPUTATION[f] = Math.max(0, before - (DECAY_PER_MIN / 60));
      else if (before < 0) REPUTATION[f] = Math.min(0, before + (DECAY_PER_MIN / 60));
      // No flag bookkeeping here: a tier lapses by the score crossing back over
      // the threshold, which standing() re-derives on every call. Clearing flags
      // on decay would re-arm the announcement for a tier the player is still in
      // part-way through, which is a worse lie than repeating nothing.
    }
  }

  const inBorder = (e) => spawnZones
    ? spawnZones.isBorder(e.spr.position.x, e.spr.position.z) : !!e.border;

  /** `living`: NPC records; `player`: {x, z}, or null to ignore distance (unit tests). */
  function update(dt, living, player = null) {
    tickDecay(dt);
    timer -= dt;
    if (timer > 0 || !living || !living.length) return;
    timer = 0.35 + Math.random() * 0.1;

    // calm gang members only: anyone already hostile (at a rival or at the player) keeps at it
    candidates.length = 0;
    engaged.length = 0;
    for (const e of living) {
      if (e.dead || e.state === "dead" || e.state === "flee") continue;
      if (!FIGHTERS.has(e.type)) continue;
      if (player && Math.hypot(e.spr.position.x - player.x, e.spr.position.z - player.z) > WATCH_RANGE) continue;
      if (e.state === "hostile") {
        // A klansman is hostile from the moment he is called out — the set
        // piece provokes the whole mob at the player. Left out of the pairing
        // entirely he would be unfightable by anyone else, and a Hoodrat
        // standing by while a night ride happens is the one thing this
        // shouldn't do. So he stays available as a target, never as an
        // instigator; everyone else still drops out once they are busy.
        if (e.type === "klansman") engaged.push(e);
        continue;
      }
      candidates.push(e);
    }

    for (let i = 0; i < candidates.length; i++) {
      if (npcs.hostileCount + 2 > MAX_HOSTILE - PLAYER_SLOTS) break;
      const a = candidates[i];
      if (a.state === "hostile") continue;      // paired up earlier this tick
      const ap = a.spr.position;
      let aBorder = null;                       // looked up only once someone's in sight

      // his own kind first, then anyone already swinging at someone else
      const pool = ENEMIES_OF[a.type].has("klansman") ? engaged : null;
      const reach = candidates.length + (pool ? pool.length : 0);
      for (let j = i + 1; j < reach; j++) {
        const b = j < candidates.length ? candidates[j] : pool[j - candidates.length];
        if (!b || b === a || !ENEMIES_OF[a.type].has(b.type)) continue;
        if (b.state === "hostile" && b.type !== "klansman") continue;
        const bp = b.spr.position;
        if ((ap.x - bp.x) ** 2 + (ap.z - bp.z) ** 2 > SIGHT_RANGE_SQ) continue;
        // A klansman is not part of the turf map — he is wherever a set piece
        // put him — so the contested-ground gate does not apply to him.
        if (a.type !== "klansman" && b.type !== "klansman") {
          if (aBorder === null) aBorder = inBorder(a);
          if (!aBorder && !inBorder(b)) continue;   // at least one of them is on contested ground
        }

        // Human request 2026-10-02: "lets make it like 1/5 chance for fights to
        // break out between the two factions randomly". Without this every pair
        // in sight squares up on the same tick, so the strip is permanently
        // shouting. One in five keeps it an event rather than ambience.
        if (Math.random() > FIGHT_CHANCE) continue;

        npcs.becomeHostile(a, b);
        // Point b back at a, except for a klansman who is already swinging at
        // the player: becomeHostile fills in a missing rivalTarget, which for
        // him is null, so it would quietly drag him off Keseme and onto the
        // Hoodrat. He keeps his target and simply has two problems.
        if (!(b.type === "klansman" && b.state === "hostile")) npcs.becomeHostile(b, a);
        // the shouting sends bystanders running
        npcs.noise((ap.x + bp.x) * 0.5, (ap.z + bp.z) * 0.5, 18);
        break;
      }
    }
  }

  return { update, notePlayerKill, standing, huntsPlayer, protectsAgainst, reputation: REPUTATION, resetReputation };
}
