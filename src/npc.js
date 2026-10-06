// ---------------------------------------------------------------------------
// npc.js — NPC behaviour: people and hogs who live here, not a swarm.
//
// Civilians, not enemies. Everyone idles, loiters and wanders their home turf
// and ignores the player; default aggression is zero. Violence nearby makes
// people scatter. Only an NPC the player actually hurts reacts, and its
// temperament decides how: it defends itself (fights back) or it flees.
//
//   idle / loiter  — standing around, facing a neighbour if one is close
//   wander         — strolling to a point on its home turf, or to another spot
//   flee           — running from gunfire or a fight, then calming down
//   hostile        — defending itself after being attacked: chase / charge / melee
//
// Cost: decisions run on staggered timers (not per frame), and distance sets
// the level of detail — near NPCs get everything, mid-range ones think rarely
// and animate every third frame, far ones are paused until you come back.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { vehicleRight } from "./vehicles.js";

const rand = (lo, hi) => lo + (hi - lo) * Math.random();
const _aim = new THREE.Vector3();
const NEAR = 55, FAR = 110;

// ---------------------------------------------------------------------------
// SPATIAL GRID for nearest-neighbour queries.
//
// Three think-time loops each wanted "the closest other NPC matching some
// predicate" (a zombie's bite target, a zombie's herd-mate, a loiterer's
// conversation partner) and each walked the WHOLE population to find it.
// main.js:3143 hands npc.js `others: enemies`, the entire live array, and
// ENEMY_CAP is 150 — so that was 150 x 150 = 22,500 pair tests per simulation
// step, and main.js:5693 runs simulate() in fixed 1/30s steps, so twice per
// displayed frame at 60 fps. 45,000 pair tests per frame, every frame, forever,
// to answer a question about a handful of nearby NPCs.
//
// It is quadratic, so it is also the wrong shape: doubling the cap would
// quadruple it, and the cap has already been raised twice this session (90 ->
// 150, plus a +45 downtown bonus).
//
// The grid is rebuilt once per simulation step, not per query, because every
// NPC moves within the same step and three queries per NPC would otherwise
// rebuild it 450 times. Cell size is ZOMBIE_SCENT (100 m), the widest radius any
// of the three searches uses, so a query can always be answered from the 3x3
// block of cells around its subject — nearest, not exhaustive.
//
// CORRECTNESS NOTE, and the reason this is safe to do: all three searches are
// NEAREST-neighbour, and each already carried its own radius cap (aggro, 18 m,
// 36 m). A candidate outside the cap could never have won. Bucketing cannot
// change which candidate wins, only how long it takes to find it. The one thing
// that WOULD change behaviour is forgetting a cell, so the query is a 3x3 sweep
// and not a single bucket.
// NOTE: declared here, but ZOMBIE_SCENT is defined further down the file, so
// this must stay a `let` assigned AFTER that constant, not a `const` initialised
// from it. A `const GRID_CELL = ZOMBIE_SCENT;` above the declaration throws
// "Cannot access 'ZOMBIE_SCENT' before initialization" at module load — and
// `node --check` does NOT catch that, because it is a temporal-dead-zone error
// at runtime, not a syntax error. Only importing the module finds it.
let GRID_CELL = 100;
const _buckets = new Map();
const _bucketKey = (cx, cz) => cx * 73856093 ^ cz * 19349663;

/** Rebuild the NPC buckets for this step. O(n), once per step. */
function buildBuckets(list) {
  _buckets.clear();
  for (const e of list) {
    if (!e || e.dead) continue;
    const pos = e.spr && e.spr.position;
    if (!pos) continue;
    const cx = Math.floor(pos.x / GRID_CELL), cz = Math.floor(pos.z / GRID_CELL);
    const k = _bucketKey(cx, cz);
    let b = _buckets.get(k);
    if (!b) { b = []; _buckets.set(k, b); }
    b.push(e);
  }
}

/**
 * Nearest live NPC to (x,z) within `radius`, passing `accept`.
 * Returns { e, d2 } with d2 SQUARED (callers compare squared too), or
 * { e: null, d2: Infinity }.
 *
 * `self` is excluded. `accept` is the caller's own type/state predicate, so
 * this stays a general helper rather than three near-identical loops.
 */
function nearestInBuckets(self, x, z, radius, accept) {
  const r2 = radius * radius;
  let best = null, bestD2 = r2;
  const cx = Math.floor(x / GRID_CELL), cz = Math.floor(z / GRID_CELL);
  // The sweep half-width is DERIVED from the radius, not fixed at 1.
  //
  // A hardcoded 3x3 is only correct while radius <= GRID_CELL. That happened to
  // hold for all three call sites (18 m, 36 m, and aggro well under ZOMBIE_SCENT)
  // so the 3x3 was not wrong in practice — but the helper is general, and a
  // caller asking for more than one cell's radius would have silently received
  // the nearest of nine buckets instead of the nearest NPC. That is a wrong
  // answer, not a slow one, and it is exactly the failure a nearest-neighbour
  // helper must never have.
  //
  // Caught by tools/qa/npc_grid_equivalence.mjs, which compares this against a
  // brute-force full scan at radii up to 145 m and found the divergence. The
  // equivalence test is the reason this is safe to change now.
  const span = Math.max(1, Math.ceil(radius / GRID_CELL));
  for (let dx = -span; dx <= span; dx++) for (let dz = -span; dz <= span; dz++) {
    const b = _buckets.get(_bucketKey(cx + dx, cz + dz));
    if (!b) continue;
    for (const o of b) {
      if (o === self || o.dead) continue;
      if (!accept(o)) continue;
      const pos = o.spr.position;
      const ddx = pos.x - x, ddz = pos.z - z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < bestD2) { bestD2 = d2; best = o; }
    }
  }
  return { e: best, d2: bestD2 };
}
const ZOMBIE_SCENT = 100;      // metres: an idle zombie inside this drifts toward the player (just under FAR, where NPCs freeze)
GRID_CELL = ZOMBIE_SCENT;      // now that ZOMBIE_SCENT exists: one cell == the widest search radius
export const MAX_HOSTILE = 7;      // never let the whole map pile onto the player
// Market Row keeps Saturday hours: bustling trade 09:00–18:00, but only from
// day 2 on — the game opens at 18:30 on day 1, so the first evening is quiet.
const MARKET_OPEN = 9, MARKET_CLOSE = 18;

// Nobody attacks unprovoked. Temperament only matters once the player hurts an
// NPC: "brave" people and "territorial" hogs defend themselves, the rest run.
export const DEFAULT_AGGRESSION = 0;
function temperament(type) {
  const r = Math.random();
  if (type === "hog") return r < 0.4 ? "territorial" : "skittish";
  // The gangs fight back (human request, 2026-10-01: NPCs were "way too afraid
  // of stuff, like gunshots", and the hostile hoodrats/rednecks were gone). At
  // 50/65% brave, shooting somebody made two thirds of the parish run away from
  // you, which reads as timidity rather than as a parish with a temper. The
  // street gangs are the ones meant to have a reputation, so they now mostly
  // stand their ground — with a real minority still bolting, because an NPC that
  // NEVER runs is its own kind of wrong. Civilians are untouched below.
  if (type === "hoodrat") return r < 0.8 ? "brave" : "timid";
  if (type === "redneck") return r < 0.85 ? "brave" : "timid";
  if (type === "thug") return r < 0.85 ? "brave" : "timid";
  // klan.js: they arrive as a mob, at night, to frighten somebody. A hood that
  // turns and runs the moment it is faced is a different scene from the one
  // being written, so they are never timid — the rest of the temperament roll
  // would have made two thirds of any night ride scatter on first contact.
  if (type === "klansman") return "brave";
  // zombie-mode (main.js): mood is moot — decide() never routes a zombie
  // through the provoked flee-or-fight check below, they're hostile from the
  // moment they notice anything — but "territorial" keeps them out of the
  // "timid"/"skittish" flee branch if that ever changes.
  if (type === "zombie") return "territorial";
  if (type === "redneck") return r < 0.5 ? "brave" : "timid";
  return r < 0.35 ? "brave" : "timid";
}

// `standing` is injected, not imported: factions.js imports THIS module, so a
// direct import back would be a cycle. It is `(type) => "enemy"|"protector"|
// "neutral"` and comes from factionWar. Absent means every gang member is
// neutral, which is the pre-reputation behaviour and keeps this module usable
// on its own (and in tests) with no wiring.
export function createNpcSystem({ pois, resolveCollision, hitPlayer, bounds, worldTime = null, maxHostile = () => MAX_HOSTILE, standing: standingArg = null }) {
  let standingFn = standingArg || (() => "neutral");
  const events = [];               // recent violence: { x, z, r, t }
  let now = 0, frame = 0, hostiles = 0, nextId = 1;
  const vel = new THREE.Vector3();
  const next = new THREE.Vector3();

  function nearestPoi(x, z) {
    let best = pois[0], bd = Infinity;
    for (const p of pois) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Market Row's Saturday hours right now (npc.js is created with worldTime). */
  function marketTrading() {
    if (!worldTime) return false;
    const h = worldTime.hours, d = worldTime.day;
    return h >= MARKET_OPEN && h < MARKET_CLOSE && d >= 2;
  }

  // The hostile budget (maxHostile) keeps a street fight readable: only so many civilians turn on
  // you at once. A zombie horde is not a street fight — with 60-300 of them out and the budget at
  // 20, everyone past the twentieth just stood there (human report, 2026-09-26) — so zombies
  // are outside it: they neither count against it nor are refused by it.
  const budgeted = (e) => e.type !== "zombie";
  function setState(e, s, time) {
    if (e.state === "hostile" && s !== "hostile") {
      if (budgeted(e)) hostiles--;
      e.rivalTarget = null;
    }
    if (s === "hostile" && e.state !== "hostile" && budgeted(e)) hostiles++;
    if (s !== "flee") e.panic = false;
    e.state = s;
    e.stateT = time != null ? time : rand(2, 5);
  }

  function pickGoal(e) {
    // mostly potter about home; now and then walk over to a nearby spot
    let base = e.home;
    if (e.type !== "hog" && Math.random() < 0.22) {   // hogs stay in their patch of woods
      const options = pois.filter((p) => p !== e.home &&
        Math.hypot(p.x - e.home.x, p.z - e.home.z) < 70);
      if (options.length) base = e.home = options[(Math.random() * options.length) | 0];
    }
    // `wanderR` comes from the spawn zone (spawnzones.js WANDER): city blocks
    // keep trips short, out in the parish they stretch out, and market day
    // crowds keep to the stalls
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * (base.r || 10) * (e.wanderR || 1) * (e.marketSaturday ? 0.5 : 1);
    e.goal.set(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r);
  }

  // Gunfire and fights: the crowd that isn't a fighter runs for its life (human request, 2026-09-26).
  // Hoodrats, rednecks, thugs and klansmen hold their ground (and fight or flee by temperament); zombies and
  // hogs have their own logic; the story's cast is scripted. Everyone else — the tourists, suits,
  // escorts, dockworkers, mechanics, hobos, the Frenchmen Street regulars — hears a shot from far
  // off and bolts, flat out and for a good while, directly away from it.
  const STANDS_GROUND = new Set(["hoodrat", "redneck", "thug", "klansman", "zombie", "hog", "mally", "bubba"]);
  // Only feral hogs and the street gangs attack on sight. Hoodrats and rednecks
  // were civilians-until-provoked between 2026-09-27 and 2026-10-01, which is
  // what removed the hostile gangs the parish is supposed to have (human
  // request, 2026-10-01: "we had the hood rats and the rednecks, that were also
  // meant to be hostile ... they all just kind of running around like pussies").
  // They are armed when they turn (main.js spawnEnemy: pistol or bat), so this
  // is a gang you can be jumped by, not a mob — MAX_HOSTILE still caps the
  // pile-on, and the timid minority still bolts instead.
  // Gang members, i.e. the types a REPUTATION can exist for. Mirrors FIGHTERS in
// factions.js; kept local rather than imported because factions.js imports this
// module and the reverse import would be a cycle.
const FIGHTERS = new Set(["redneck", "hoodrat", "thug"]);

// Feral hogs only (human report 2026-10-02: "HOODRATS N REDNECKS STILL ATTACK
// WITHOUT BEING PROVOKED").
//
// hoodrat and redneck used to be listed here as well as in FIGHTERS, and that
// silently defeated the whole "gangs are civilians until you hit them" change:
// the FIGHTERS branch is correctly gated on faction standing, but this branch is
// an unconditional on-sight attack with no standing check at all, so every
// hoodrat and redneck still turned on the player the moment they walked into
// aggro range. Two lists, two behaviours, only one of them fixed.
//
// A territorial HOG still attacks on sight and that is right — it reads as an
// animal defending ground rather than a person picking a fight. Ambush-type NPCs
// only reach this branch when their standing is not "enemy", because the
// FIGHTERS branch above already returned in that case, so no behaviour is lost.
const AMBUSHERS = new Set(["hog"]);
  const PANIC_HEARING = 1.8;            // x the event's own radius: a pistol carries ~47 m, a shotgun ~72 m
  function panicEvent(p) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (now - ev.t > 4) break;
      const r = ev.r * PANIC_HEARING;
      if ((ev.x - p.x) ** 2 + (ev.z - p.z) ** 2 < r * r) return ev;
    }
    return null;
  }

  function recentViolence(p) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (now - ev.t > 4) break;
      if ((ev.x - p.x) ** 2 + (ev.z - p.z) ** 2 < ev.r * ev.r) return ev;
    }
    return null;
  }

  /**
   * `force` skips the crowd cap. That cap exists so an ambient street brawl
   * cannot eat the frame budget, and ambient fights should keep respecting it —
   * but a SCRIPTED fight has a fixed, known cast, and an ally who silently
   * refuses to join in because six other people are already swinging is a bug
   * the player reads as "Mally just stood there". klan.js uses it for Bubba and
   * Mally; nothing ambient should.
   */
  function becomeHostile(e, rivalTarget = null, force = false) {
    if (e.state === "hostile") {
      if (rivalTarget && (!e.rivalTarget || e.rivalTarget.dead)) e.rivalTarget = rivalTarget;
      return true;
    }
    if (!force && budgeted(e) && hostiles >= maxHostile()) return false;
    e.rivalTarget = rivalTarget || null;
    setState(e, "hostile", 0);
    e.calm = 0;
    return true;
  }

  function flee(e, fromX, fromZ) {
    e.threat.set(fromX, 0, fromZ);
    setState(e, "flee", rand(4, 7));
  }

  // `loud`: a Screamer's wail — answered by every zombie in range, even ones
  // whose archetype ignores ordinary distant noise (see the zombie branch)
  function noise(x, z, r = 22, loud = false) {
    events.push({ x, z, r, t: now, loud });
    if (events.length > 32) events.shift();
  }

  function release(e) {
    if (e.state === "hostile" && budgeted(e)) hostiles--;
    if (e.solicitVeh) {
      if (e.solicitVeh.seats && e.solicitVeh.seats[1] && e.solicitVeh.seats[1].occupant === e) {
        e.solicitVeh.seats[1].occupant = null;
      }
      if (e.solicitVeh.obj) e.solicitVeh.obj.rotation.z = 0;
      e.solicitVeh = null;
    }
    if (e.spr) e.spr.visible = true;
    e.rivalTarget = null;
    e.state = "dead";
  }

  // a turf fight blow (factions.js); a kill goes through env.killEnemy for the loot
  function hitRival(victim, dmg, env, attacker) {
    if (victim.dead || victim.state === "dead") return;
    victim.hp -= dmg;
    noise(victim.spr.position.x, victim.spr.position.z, 15);
    if (victim.hp > 0) return;
    if (env.killEnemy) env.killEnemy(victim, { turf: true, killer: attacker });
    else { release(victim); victim.dead = true; }
  }

  function decide(e, dist, env) {
    // Held for a conversation: do not re-pick a goal. act() already returns early
    // on the hold, but decide() runs on its own think tick and would otherwise keep
    // rewriting e.goal underneath the hold, which is what makes an NPC twitch on
    // the spot instead of standing still.
    if (e.talkHold) return;
    const p = e.spr.position;
    const interval = e.lod ? 1 : 0.3;

    if (e.state === "approaching_car" || e.state === "in_car") {
      if (e.provoked) {
        if (e.solicitVeh && e.solicitVeh.seats && e.solicitVeh.seats[1] && e.solicitVeh.seats[1].occupant === e) {
          e.solicitVeh.seats[1].occupant = null;
        }
        if (e.solicitVeh && e.solicitVeh.obj) e.solicitVeh.obj.rotation.z = 0;
        e.solicitVeh = null;
        e.provoked = false;
        if (e.spr) e.spr.visible = true;
        flee(e, env.player.x, env.player.z);
      }
      return;
    }

    // Zombie-mode horde (main.js: state.zombieMode, night only). Unlike every
    // other type here, a zombie is never provoked into hostility — it hunts on
    // its own, at the player or at any other living NPC, whichever is closer,
    // and once it has a target it never loses interest the way a turf fight or
    // a shooting spree does. Handled entirely separately from the rest of
    // decide() so it skips flee/provoke/calm-down, none of which apply to it.
    if (e.type === "zombie") {
      // Safehouses (safehouses.js, TASK-082): a zombie that finds itself inside
      // one drops whatever it was doing and wanders back out, so the radius is
      // a real exclusion zone, not just a spawn filter. `env.safehouseAt` is
      // absent outside main.js's env (tests), where this is simply skipped.
      const sh = env.safehouseAt && env.safehouseAt(p.x, p.z);
      if (sh) {
        const ox = p.x - sh.x, oz = p.z - sh.z, od = Math.hypot(ox, oz) || 1;
        setState(e, "wander", 0);
        e.goal.set(sh.x + (ox / od) * (sh.r + 6), 0, sh.z + (oz / od) * (sh.r + 6));
        return;
      }
      const st = env.stealth != null ? env.stealth : 1;      // see below
      if (e.state === "hostile") {
        // the only way a zombie drops its target: the target is actually dead
        if (e.rivalTarget && (e.rivalTarget.dead || e.rivalTarget.state === "dead")) e.rivalTarget = null;
        // ...or the player has ducked into a safehouse and it was hunting them
        if (!e.rivalTarget && env.playerSafe) setState(e, "idle", rand(1, 3));
        // ...or you have slipped away: crawling through the dark, far enough out, for long enough
        else if (!e.rivalTarget && st < 0.7 && dist > e.T.aggro * st * 2.4) {
          e.calm += interval;
          if (e.calm > 5) { setState(e, "idle", rand(1, 3)); e.calm = 0; }
        } else e.calm = 0;
        return;
      }
      // How far the dead notice you is the zombie's own range scaled by your stealth (crouching, crawling,
      // standing still, Sneak, a torch, a gunshot — main.js computes it); 1 when nothing supplies one.
      const aggro = e.T.aggro * st;
      // nearest OTHER NPC (never another zombie) inside aggro, via the grid.
      // The helper returns SQUARED distance, so the comparison below is squared
      // too and the sqrt is paid at most once, only when a candidate actually
      // wins — rather than once per pair as the old scan did.
      const bite = nearestInBuckets(e, p.x, p.z, aggro, (o) =>
        o.state !== "dead" && o.type !== "zombie");
      let bestD = aggro, target = null;
      if (dist < bestD && !env.playerSafe) bestD = dist;
      if (bite.d2 < bestD * bestD) { bestD = Math.sqrt(bite.d2); target = bite.e; }
      if (bestD < aggro) {
        // whoever just got bitten reacts in character — the same brave-fights,
        // rest-flee split as being provoked by the player, just aimed at the
        // zombie instead. Skipped if the zombie itself failed to go hostile
        // (the shared hostile budget is full) — no bite landed, no reaction.
        const hostile = becomeHostile(e, target);
        // The rare Screamer still calls nearby zombies toward its location,
        // but the audio wail is disabled: no scream callback or sound is played.
        //
        // THE HORDE CALL. This used to be `noise(p.x, p.z, hordeCall.r, true)`,
        // and that is why zombies never swarmed (human report 2026-10-02: "the
        // zombies aint really like forming hordes or swarms either ??").
        //
        // A noise event is not a horde call. Looking at what a noise event
        // actually does: it reaches other zombies only through recentViolence()
        // at line ~314, and its ENTIRE effect there is
        //     setState(e, "wander", 0); e.goal.set(ev.x, 0, ev.z);
        // — a walk-to. Not one call to becomeHostile. So the Screamer was
        // politely asking 55 m of zombies to amble somewhere nearby, and they
        // would arrive as idlers that still had to notice the player on their
        // own. A horde is not a queue at a point; it is a pack that arrives
        // already fighting. On top of that the Screamer is weight 2 of 89
        // (~2%), so almost nothing in the parish could even emit the call.
        //
        // So the call now actually converts: every idle or wandering zombie
        // inside the radius is turned hostile with the caller as its rival
        // target, which is what makes them converge on the same victim instead
        // of each picking their own. force=true is deliberate — this is the
        // "rare screamer breaks the cap" moment, and a horde that respects the
        // ambient budget is not a horde.
        const hordeCall = e.T.zombieFlags && e.T.zombieFlags.screamOnHostile;
        if (hostile && hordeCall && !e.screamed) {
          e.screamed = true;
          noise(p.x, p.z, hordeCall.r, true);          // audible to the player AND to other zombies
          const R2 = hordeCall.r * hordeCall.r;
          let called = 0;
          // `npcs` was never a binding in this module -- it is undefined, so a
          // Screamer that reached this branch threw ReferenceError and the horde
          // call silently never happened. decide() already receives `env`, whose
          // `others` is the agent population (main.js:3150 passes `enemies`), and
          // update() is called per-agent with no internal list to close over. So
          // read it from env, and tolerate its absence rather than throwing --
          // a Screamer with no population list should still wail.
          const crowd = Array.isArray(env && env.others) ? env.others : [];
          for (const o of crowd) {
            if (o === e || o.dead || o.type !== "zombie") continue;
            if (o.state === "hostile" || o.state === "flee" || o.state === "dead") continue;
            const dx = o.spr.position.x - p.x, dz = o.spr.position.z - p.z;
            if (dx * dx + dz * dz > R2) continue;
            if (becomeHostile(o, e, true)) called++;
          }
          e.hordeCalled = called;
        }
        if (hostile && target && target.state !== "hostile" && target.state !== "flee" && !target.dead) {
          if (target.mood === "timid" || target.mood === "skittish") flee(target, p.x, p.z);
          else becomeHostile(target, e);
        }
        return;
      }
      // nothing in biting range: shamble toward the last thing that made noise
      // (gunfire, a kill, a fight) — the horde is drawn to a shooting spree —
      // otherwise wander like anyone else waiting to notice something
      // (an archetype's noiseResponse caps how far it will be drawn: the Brute
      // lumbers on past a gunshot two blocks over)
      const ev = recentViolence(p);
      const hearRange = e.T.aggro * ((e.T.zombieFlags && e.T.zombieFlags.noiseResponse) || 1);
      if (ev && (ev.loud || (ev.x - p.x) ** 2 + (ev.z - p.z) ** 2 <= hearRange * hearRange)) {
        setState(e, "wander", 0); e.goal.set(ev.x, 0, ev.z); return;
      }
      // The player's scent: out of biting range, a zombie is still drawn toward a player within
      // ZOMBIE_SCENT metres — the horde converges on you rather than milling about where it rose.
      // (Not when the player is in a safehouse.) It reads as a shamble, not a charge: the wander
      // speed, with a jitter so a crowd spreads out.
      if (dist < ZOMBIE_SCENT * st && !env.playerSafe) {
        if (e.state !== "wander" || e.stateT <= 0 || (e.goal.x - p.x) ** 2 + (e.goal.z - p.z) ** 2 < 4) {
          setState(e, "wander", rand(2, 4));
          const a = Math.random() * Math.PI * 2, r = rand(0, 3);
          e.goal.set(env.player.x + Math.cos(a) * r, 0, env.player.z + Math.sin(a) * r);
        }
        return;
      }
      if (e.state === "wander") {
        if ((e.goal.x - p.x) ** 2 + (e.goal.z - p.z) ** 2 < 1.5 || e.stateT < -14) setState(e, "idle", rand(0.5, 3));
        return;
      }
      if (e.stateT <= 0) {
        setState(e, "wander", 0);
        // The horde: a spawned knot stays a knot. Wander toward whichever
        // other still-wandering zombie is nearest, jittered a few metres off
        // its position, rather than each one picking its own independent
        // random walk (pickGoal) — a cluster main.js spawned together then
        // shambles in as a visible mass instead of dispersing the moment
        // they're on their feet. Falls back to the ordinary wander when
        // nothing else is close (a straggler, or the last one standing).
        const found = nearestInBuckets(e, p.x, p.z, 18, (o) =>
          o.type === "zombie" && o.state !== "dead" && o.state !== "hostile");
        const herd = found.e;
        if (herd) {
          const a = Math.random() * Math.PI * 2, r = rand(2, 6);
          e.goal.set(herd.spr.position.x + Math.cos(a) * r, 0, herd.spr.position.z + Math.sin(a) * r);
        } else {
          pickGoal(e);
        }
      }
      return;
    }

    // keep market hours fresh (cheap, and the staggered think tick already
    // runs well under once a second per NPC)
    if (e.wanderSpeed < 1) e.marketSaturday = marketTrading();

    if (e.state === "hostile") {
      // hurt by the player in the middle of a turf fight: the player is now the problem
      if (e.provoked) { e.provoked = false; e.rivalTarget = null; e.calm = 0; }
      if (e.rivalTarget) {
        if (e.rivalTarget.dead || e.rivalTarget.state === "dead") {
          e.rivalTarget = null;
          setState(e, "wander");
          pickGoal(e);
          return;
        }
        const rPos = e.rivalTarget.spr.position;
        const rDist = Math.hypot(rPos.x - p.x, rPos.z - p.z);
        if (rDist > e.T.aggro + 18) {
          e.calm += interval;
          if (e.calm > 6) { e.rivalTarget = null; setState(e, "wander"); pickGoal(e); }
        } else e.calm = 0;
        return;
      }
      // lose interest once the player is well out of reach for a while
      if (dist > e.T.aggro + 18) {
        e.calm += interval;
        if (e.calm > 6) { setState(e, "wander"); pickGoal(e); }
      } else e.calm = 0;
      return;
    }

    if (e.provoked) {
      e.provoked = false;
      // hurt: fight back unless timid (or a skittish hog), otherwise run
      if (e.mood === "timid" || e.mood === "skittish" || !becomeHostile(e)) flee(e, env.player.x, env.player.z);
      return;
    }

    // Reputation (human request 2026-10-02, GTA2-style gangs): a faction the
    // player has made infamous attacks on sight, with no provocation, because
    // the whole faction now knows their face. This is the ONLY thing that makes
    // gang members aggressive by default — a neutral hoodrat or redneck is still
    // a civilian until hit, which is what the player asked for. Protectors are
    // handled below: they are the one gang that does NOT come at the player.
    if (FIGHTERS.has(e.type)) {
      const st2 = standingFn(e.type);
      if (st2 === "enemy" && e.mood !== "timid" && e.mood !== "skittish" &&
          !env.playerSafe && !(env.state && env.state.cinematic)) {
        const reach = e.T.aggro * (env.stealth != null ? env.stealth : 1) * (env.veh ? 0.6 : 1) * 1.6;
        if (dist < reach && becomeHostile(e)) return;
      }
      if (st2 === "protector") {
        // Protectors never open on the player. They do intervene: if a RIVAL is
        // already swinging at the player and one is close enough to see, this
        // one joins in — the faction stepping between the player and their
        // declared enemy. Deliberately limited to a short radius so it reads as
        // "these ones came to help" rather than a permanent guard.
        const foe = e.rivalTarget;
        const foeOnPlayer = foe && !foe.dead && foe.state === "hostile" &&
          !foe.rivalTarget && Math.hypot(foe.spr.position.x - env.player.x, foe.spr.position.z - env.player.z) < 12;
        if (foeOnPlayer && dist < 26 && becomeHostile(e, foe)) return;
      }
    }

    // Feral (territorial) hogs go for the player on sight — inside their own `aggro` range, shrunk by stealth and by being in a car — without
    // waiting to be hurt first. (Hoodrats and rednecks no longer do: they are civilians until provoked. Timid ones, and skittish hogs, still run.) The hostile budget (maxHostile) still caps the pile-on.
    if (AMBUSHERS.has(e.type) && e.state !== "flee" && e.mood !== "timid" && e.mood !== "skittish" &&
        !env.playerSafe && !(env.state && env.state.cinematic)) {
      const reach = e.T.aggro * (env.stealth != null ? env.stealth : 1) * (env.veh ? 0.6 : 1);
      if (dist < reach && becomeHostile(e)) return;
    }

    // gunfire or a fight nearby: bystanders scatter, nobody joins in
    if (!STANDS_GROUND.has(e.type)) {
      const pev = panicEvent(p);
      // Only a fresh fright may restart a run, and `e.panic` is the flag that
      // says this person is ALREADY running from something. Without this guard
      // every bystander in earshot re-entered this branch on every single frame
      // for as long as the noise event was alive, because line 392's flee() below
      // sets state "flee" WITHOUT setting `panic` — so the test read
      // `!e.panic` as true, fled again, and reset stateT to 8-12s on each pass.
      // A run therefore never ended: the NPC sprinted until the state machine
      // happened to land them somewhere else, which in a busy street is to say
      // never. That is the "everybody is permanently panicking" report.
      if (pev && !e.panic) {
        flee(e, pev.x, pev.z);
        e.panic = true;
        e.stateT = rand(8, 12);                    // a long run, not a few steps
        return;
      }
    }
    // (the fighters never take this exit either: a shot or a brawl beside a hoodrat, redneck or thug is not a reason to leave;
    // it was only the panic branch above that spared them, so they still ran from anything within the noise radius)
    const ev = STANDS_GROUND.has(e.type) ? null : recentViolence(p);
    // Same one-shot rule as the panic branch above, and for the same reason: a
    // flee started here leaves `panic` false, so without `!e.panic` this
    // re-triggers every frame while the fight lasts and the run never ends.
    if (ev && e.state !== "flee" && !e.panic) {
      flee(e, ev.x, ev.z);
      e.panic = true;
      return;
    }
    // (the player merely being close is not a reason to do anything)

    // Working girls call out to a player on foot: strut over, stop a few metres off, and make the offer (main.js speaks the line).
    // Never while the player is in a car (that is the honk-and-pick-up trade) or in the middle of a fight / flight.
    if ((e.type === "prostitute" || e.type === "highendescort") && !env.veh && !env.playerSafe && env.onSolicit &&
        (e.state === "idle" || e.state === "wander" || e.state === "loiter") && dist < 16 && now >= (e.solicitAt || 0)) {
      e.solicitAt = now + rand(16, 32);
      if (dist > 3.2) {
        setState(e, "wander", rand(4, 7));
        const k = 2.4 / dist;
        e.goal.set(env.player.x + (p.x - env.player.x) * k, 0, env.player.z + (p.z - env.player.z) * k);
      }
      env.onSolicit(e, dist);
      return;
    }

    if (e.state === "flee") {
      if (e.stateT <= 0) setState(e, "idle", rand(1, 3));
      return;
    }
    if (e.state === "wander") {
      if ((e.goal.x - p.x) ** 2 + (e.goal.z - p.z) ** 2 < 1.5 || e.stateT < -14) setState(e, "idle", rand(0.5, 3));
      return;
    }
    if (e.stateT <= 0) {
      const r = Math.random();
      // pedestrians walk more than they stand: ~3/4 of decisions start a stroll,
      // and the market crowd is here to browse, so almost always
      if (r < (e.marketSaturday ? 0.88 : 0.74)) { setState(e, "wander", 0); pickGoal(e); }
      else {
        setState(e, "loiter", rand(3, 8));
        // face whoever is standing nearest, so groups read as conversations
        // already squared; now also bucketed, so it is O(neighbours) not O(n)
        const buddy = nearestInBuckets(e, p.x, p.z, 36, () => true).e;
        e.face = buddy ? Math.atan2(buddy.spr.position.x - p.x, buddy.spr.position.z - p.z) : null;
      }
    }
  }

  function act(e, dt, dist, env) {
    const p = e.spr.position, T = e.T, hog = e.type === "hog";
    vel.set(0, 0, 0);
    let anim = "idle", fps = 5;

    // Held for a conversation. Human request 2026-10-02: "if u talk to NPCs they
    // should stop in front of u not walk away".
    //
    // Placed immediately after vel is zeroed and BEFORE every branch below, rather
    // than zeroing vel at the end. Zeroing at the end would still leave decide()
    // free to re-pick a goal every think tick, so the NPC would fight the hold and
    // twitch on the spot -- worse than the original bug. Returning here also skips
    // the panic/flee/hostile branches on purpose: someone mid-conversation should
    // not start running because a car backfired.
    if (e.talkHold) {
      if (e.talkHold.face) {
        const dx = e.talkHold.x - p.x, dz = e.talkHold.z - p.z;
        if (dx * dx + dz * dz > 1e-4) {
          if (e.spr._yaw != null) e.spr._yaw = Math.atan2(dx, dz);
          e.spr.setFlip(dx);
        }
      }
      if (e.spr.anim !== "talk") e.spr.play("talk", { fps: 6, loop: true });
      else e.spr.play("talk", { fps: 6, loop: true });
      return;                    // vel stays (0,0,0): they hold position
    }

    if (e.state === "hostile") {
      const hasRival = e.rivalTarget && !e.rivalTarget.dead && e.rivalTarget.state !== "dead";
      const targetPos = hasRival ? e.rivalTarget.spr.position : env.player;
      const targetDist = hasRival ? Math.hypot(targetPos.x - p.x, targetPos.z - p.z) : dist;
      const inv = targetDist > 1e-4 ? 1 / targetDist : 0;
      const dx = (targetPos.x - p.x) * inv, dz = (targetPos.z - p.z) * inv;

      if (hog) {
        // hogs line up, then explosively charge in a straight line
        if (e.charge > 0) {
          e.charge -= dt;
          vel.copy(e.chargeDir).multiplyScalar(13);
        } else if (e.chargeCd === 0 && targetDist < 14 && targetDist > 2) {
          e.charge = 0.55; e.chargeCd = 2.4;
          e.chargeDir.set(dx, 0, dz);
          vel.copy(e.chargeDir).multiplyScalar(13);
        } else {
          vel.set(dx * T.speed, 0, dz * T.speed);
        }
        if (targetDist < T.melee && e.atkCd === 0) {
          e.atkCd = T.atkGap;
          if (hasRival) hitRival(e.rivalTarget, T.dmg, env, e);
          else hitPlayer(T.dmg);
          e.charge = 0;
        }
        anim = e.charge > 0 ? "charge" : "walk";
      } else if (e.arm === "pistol" && !hasRival && env.shootPlayer && targetDist < 22 && targetDist > 2.5 &&
                 (!env.lineClear || env.lineClear(p.x, p.z, targetPos.x, targetPos.z))) {      // (no clear shot: fall through and close in instead)
        // armed (main.js spawnEnemy): a pistol stops the chase, squares up and shoots — a burst of one, every second or two
        anim = "idle"; e.aiming = true;
        if (e.spr._yaw != null) e.spr._yaw = Math.atan2(dx, dz);
        if (e.atkCd === 0) {
          e.atkCd = rand(1.0, 1.9);
          e.fireT = 0.18;
          env.shootPlayer(e, T.dmg * 0.9);
        }
      } else if (targetDist < T.melee) {
        anim = "attack"; fps = 10;
        // a bat hits harder than fists; the swing is the rig's own (weapons_3d.js RemoteWeaponRig.anim)
        if (e.atkCd === 0) {
          e.atkCd = T.atkGap;
          if (e.arm === "bat" && e.rig) e.rig.anim = { type: "swing", time: 0.5, duration: 0.5 };
          const d = e.arm === "bat" ? T.dmg * 1.5 : T.dmg;
          if (hasRival) hitRival(e.rivalTarget, d, env, e);
          else hitPlayer(d);
        }
        e.spr.setFlip(dx);
        if (e.spr._yaw != null) e.spr._yaw = Math.atan2(dx, dz);
      } else {
        vel.set(dx * T.speed, 0, dz * T.speed);
        anim = "walk"; fps = 9;
      }
    } else if (e.state === "flee") {
      const fx = p.x - e.threat.x, fz = p.z - e.threat.z;
      const d = Math.hypot(fx, fz) || 1;
      const s = (hog ? 7 : T.speed * (e.panic ? 2.3 : 1.2)) * e.pace;      // a panicked one sprints
      vel.set((fx / d) * s, 0, (fz / d) * s);
      anim = "walk"; fps = 12;
    } else if (e.state === "wander") {
      const gx = e.goal.x - p.x, gz = e.goal.z - p.z;
      const d = Math.hypot(gx, gz);
      if (d > 0.5) {
        // zone sets the pace (spawnzones.js WANDER): city folk hurry, the
        // parish ambles, and Market Row's Saturday crowd weaves between the
        // stalls; hogs are untouched
        const s = (hog ? 1.3 : 1.7 * (e.wanderSpeed || 1) * (e.marketSaturday ? 1.4 : 1)) * e.pace;
        vel.set((gx / d) * s, 0, (gz / d) * s);
        anim = "walk"; fps = 6;
      }
    } else if (e.state === "loiter") {
      if (e.stateT <= 0) { setState(e, "wander", 0); pickGoal(e); }   // nobody loiters forever
      else if (e.face != null && e.spr._yaw != null) {
        e.spr._yaw += (e.face - e.spr._yaw) * Math.min(1, dt * 3);
      }
    } else if (e.state === "approaching_car") {
      const v = e.solicitVeh;
      if (!v || v.dead || !v.obj) {
        e.solicitVeh = null;
        setState(e, "wander", 0);
        pickGoal(e);
        return;
      }
      e.solicitTimer = (e.solicitTimer || 15) - dt;
      const doorOffset = new THREE.Vector3();
      vehicleRight(v, doorOffset);
      doorOffset.multiplyScalar(2.2);
      const doorPos = doorOffset.add(v.obj.position);
      e.goal.copy(doorPos);
      const gx = doorPos.x - p.x, gz = doorPos.z - p.z;
      const d = Math.hypot(gx, gz);

      if (d < 2.2 && Math.abs(v.speed || 0) < 2.5 && v.seats && v.seats[1] && !v.seats[1].occupant) {
        e.state = "in_car";
        v.seats[1].occupant = e;
        e.inCarTimer = 3.5;
        if (e.spr) e.spr.visible = false;
        if (typeof env.flashObjective === "function") {
          env.flashObjective("Prostitute entered vehicle ($50 for health)");
        }
      } else if (e.solicitTimer <= 0 || d > 28) {
        e.solicitVeh = null;
        setState(e, "wander", 0);
        pickGoal(e);
      } else {
        const s = T.speed * 1.1;
        vel.set((gx / (d || 1)) * s, 0, (gz / (d || 1)) * s);
        anim = "walk"; fps = 8;
      }
    } else if (e.state === "in_car") {
      const v = e.solicitVeh;
      if (e.spr) e.spr.visible = false;
      if (!v || v.dead || env.veh !== v) {
        if (v && v.seats && v.seats[1] && v.seats[1].occupant === e) v.seats[1].occupant = null;
        if (v && v.obj) v.obj.rotation.z = 0;
        e.solicitVeh = null;
        if (e.spr) e.spr.visible = true;
        setState(e, "wander", 0);
        pickGoal(e);
        return;
      }
      if (v.obj) v.obj.rotation.z = Math.sin(e.t * 14) * 0.035;
      e.inCarTimer = (e.inCarTimer || 3.5) - dt;
      if (e.inCarTimer <= 0) {
        if (v.obj) v.obj.rotation.z = 0;
        if (env.state) {
          // Count completed passenger rides so campaign missions can require
          // several pickups even though the vehicle has one passenger seat.
          env.state.prostituteTrips = (env.state.prostituteTrips || 0) + 1;
          env.state.cash = Math.max(0, (env.state.cash || 0) - 50);
          env.state.hp = Math.min(100, (env.state.hp || 100) + 50);
          if (typeof env.syncHUD === "function") env.syncHUD();
        }
        if (typeof env.flashObjective === "function") {
          env.flashObjective("Full service complete! +50 HP (-$50)");
        }
        const doorOffset = new THREE.Vector3();
        vehicleRight(v, doorOffset);
        doorOffset.multiplyScalar(2.4);
        e.spr.position.copy(v.obj.position).add(doorOffset);
        if (e.spr) e.spr.visible = true;
        if (v.seats && v.seats[1]) v.seats[1].occupant = null;
        e.solicitVeh = null;
        setState(e, "wander", 0);
        pickGoal(e);
      }
      return;
    }

    // presentation
    if (e.rig && !hog) {
      // what an armed one holds: carried at rest, levelled when it is aiming, swung when it hits (weapons_3d.js)
      const yaw = e.spr._yaw || 0;
      _aim.set(Math.sin(yaw), 0, Math.cos(yaw));
      if (e.fireT > 0) e.fireT -= dt;
      if (e.rig.anim && e.rig.anim.time > 0) e.rig.anim.time -= dt;
      e.rig.update(_aim, e.arm, dt, !!e.aiming, e.fireT > 0);
      e.aiming = false;
    }
    if (hog) {
      if (vel.lengthSq() > 0.01) e.spr.rotation.y = Math.atan2(vel.x, vel.z);
      const moving = anim !== "idle";
      const gait = moving ? Math.sin(e.t * (anim === "charge" ? 30 : 12)) * 0.12 : 0;
      const legs = e.spr.userData.legs;
      for (let i = 0; i < legs.length; i++) legs[i].position.y = 0.35 + (i % 2 ? gait : -gait);
      e.spr.position.y = anim === "charge" ? Math.abs(Math.sin(e.t * 30)) * 0.15 : 0;
    } else {
      if (anim === "walk" && Math.abs(vel.x) > 0.05) e.spr.setFlip(vel.x);
      if (e.spr.anim !== "hurt" || e.spr.finished) e.spr.play(anim, { fps, loop: true });
    }

    if (vel.lengthSq() > 0) {
      next.copy(p).addScaledVector(vel, dt);
      resolveCollision(p, next, 0.5);
      // bounds: a half-size (square map) or { minX, maxX, minZ, maxZ }
      const B = typeof bounds === "number"
        ? { minX: -bounds, maxX: bounds, minZ: -bounds, maxZ: bounds } : bounds;
      p.x = THREE.MathUtils.clamp(p.x, B.minX + 3, B.maxX - 3);
      p.z = THREE.MathUtils.clamp(p.z, B.minZ + 3, B.maxZ - 3);
    }

    if (e.leash) pen(e);
  }

  // a mission pen (e.leash = { x, z, r }, e.g. Hog Wild's herd): whatever the state,
  // fleeing, charging or knocked back by a shot, it slides along the edge, never out
  function pen(e) {
    const p = e.spr.position, L = e.leash;
    const lx = p.x - L.x, lz = p.z - L.z, ld = Math.hypot(lx, lz);
    if (ld <= L.r) return;
    p.x = L.x + (lx / ld) * L.r;
    p.z = L.z + (lz / ld) * L.r;
    e.charge = 0;                          // a charge ends at the edge instead of ramming it
  }

  return {
    get hostileCount() { return hostiles; },
    becomeHostile,
    noise,
    panicEvent,
    release,

    /** Give a freshly spawned NPC record its temperament and home turf. */
    init(e) {
      e.id = nextId++;
      e.mood = temperament(e.type);
      // people hang out at the nearest hangout; a hog's home is the woods it was born in
      e.home = e.type === "hog"
        ? { x: e.spr.position.x, z: e.spr.position.z, r: 14 }
        : nearestPoi(e.spr.position.x, e.spr.position.z);
      e.goal = new THREE.Vector3().copy(e.spr.position);
      e.threat = new THREE.Vector3();
      e.chargeDir = new THREE.Vector3();
      e.pace = rand(0.8, 1.2);
      e.wanderR = e.wanderR || 1;          // zone profile, set by the spawner
      e.wanderSpeed = e.wanderSpeed || 1;
      e.marketSaturday = e.wanderSpeed < 1 && marketTrading();
      e.think = Math.random() * 0.6;        // stagger: never all on the same frame
      e.calm = e.stare = 0;
      e.provoked = false;
      e.face = null;
      e.state = "idle";
      e.stateT = rand(0.5, 4);
      e.lod = 0;
    },

    /** The player hurt this NPC directly. */
    provoke(e) { e.provoked = true; e.think = 0; },

    /**
     * Late-bind the reputation lookup. factions.js needs this system to exist
     * before it can be constructed, so main.js hands it over afterwards instead
     * of the two importing each other. Defaults to "neutral" for everyone.
     */
    setStanding(fn) { standingFn = fn; },

    /**
     * Send one NPC running from a point, bookkeeping included — `flee` already
     * did this internally and nothing outside could reach it. cemetery.js uses
     * it when Marie Laveau breaks a night ride on her own ground; setting
     * `e.state = "flee"` by hand instead would leak the `hostiles` counter and
     * slowly starve MAX_HOSTILE.
     */
    scatter(e, fromX, fromZ) { flee(e, fromX, fromZ); },

    beginFrame(dt) { now += dt; frame++; },

    /**
     * Rebuild the nearest-neighbour buckets for this simulation step.
     *
     * Called ONCE per step by main.js BEFORE the per-NPC update loop, never
     * inside it. That ordering is the whole point: rebuilding per query would
     * cost 150 rebuilds per step and be worse than the O(n^2) scan it replaced,
     * and rebuilding lazily inside update() would be a subtle correctness bug —
     * NPC #1 would query against a grid that does not yet contain NPC #150, so
     * the answer would depend on update order. One rebuild, before anyone asks.
     *
     * Grid state is deliberately module-level rather than per-system: there is
     * exactly one NPC system, and a per-instance grid would be one more thing to
     * keep in sync for no benefit.
     */
    rebuildNeighbourGrid() { buildBuckets(this._others || []); },

    /** main.js sets this once so the grid can be rebuilt without threading env. */
    setPopulation(list) { this._others = list; },
    // Human request 2026-10-02: "if u talk to NPCs they should stop in front of u
    // not walk away". Hold an NPC still, optionally turned to face (x, z).
    // Pass null to release -- which the caller MUST do when the conversation ends,
    // or the NPC is a statue for the rest of the game. main.js drives that from
    // `dialogue.active`, polled every frame, so no route of closing the box can
    // strand anybody.
    //
    // Deliberately does NOT move the NPC to a fixed spot in front of the player:
    // they stop where they already stand and turn. Snapping them somewhere would
    // look like a teleport, and would read as the game rearranging the street.
    holdStill(e, x, z, face = true) {
      if (!e) return;                                   // release
      if (e.talkHold) { e.talkHold.x = x; e.talkHold.z = z; e.talkHold.face = face; return; }
      e.talkHold = { x, z, face };
      e.think = 0;                                      // force a fresh decide next tick
    },
    releaseHold(e) { if (e) e.talkHold = null; },

    /**
     * Advance one living NPC. `env`: { player: {x,z}, driving, others }.
     * Returns true when its animation should be updated this frame.
     */
    update(e, dt, env) {
      const p = e.spr.position;
      const dist = Math.hypot(env.player.x - p.x, env.player.z - p.z);
      e.lod = dist < NEAR ? 0 : dist < FAR ? 1 : 2;
      if (e.leash) pen(e);                 // held even while frozen far from the player
      // far away and not after you: frozen until you come back
      if (e.lod === 2 && e.state !== "hostile") return false;

      e.t += dt;
      e.stateT -= dt;
      e.atkCd = Math.max(0, e.atkCd - dt);
      e.chargeCd = Math.max(0, e.chargeCd - dt);
      e.think -= dt;
      if (e.think <= 0) {
        e.think = (e.lod ? 0.9 : 0.25) + Math.random() * 0.15;
        decide(e, dist, env);
      }
      act(e, dt, dist, env);
      return e.lod === 0 || (frame + e.id) % 3 === 0;
    },
  };
}
