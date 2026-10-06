// ---------------------------------------------------------------------------
// streetlife.js — the people who make a city look inhabited.
//
//   const S = createStreetLife({ scene, resolveCollision, isNight, camera })
//   S.build(routes)             routes: [{ a: [x, z], b: [x, z], kind, name }]
//   S.update(dt, playerPos)
//   S.get props()               anything that moves: main.js keeps it out of batchStatic
//   S.panic(x, z, r)            gunfire scatters them (see below)
//
// "general city-like NPCs like businessmen and like cops patrolling streets etc"
// (human request, 2026-10-01), and then "there should be more NPCs that are like
// generic non violent like NPCs like businessman and hookers and shit just
// walking around footpaths doin their thing too.. It needs to FEEL like a
// fucking city" (2026-10-02).
//
// The city grew from four hundred and sixty-five blocks of new building with
// nobody in any of it. Traffic makes a road look used; it does not make a
// street look like a street. What makes a city read as inhabited is PEOPLE on
// the PAVEMENT — walking it, waiting at it, crossing it, standing in twos on
// the corner — and this is the cheapest and largest win available, because
// these are the same rigs the rest of the game already casts.
//
// TWO KINDS OF PERSON, and they are different in kind rather than in colour:
//
//   the ARCHETYPE  who they are: a businessman in a suit, a shop worker, a
//                  prostitute working the corner, a tourist, a beat cop. This
//                  is what the player sees and it is what the casting is for.
//   the BEAT       what they are doing with their time: `walk` the pavement,
//                  `dwell` at a kerb or a shopfront, `cross` the road, or
//                  `group` — two or three of them walking abreast to the same
//                  place, which is the difference between "a street with
//                  people on it" and "a city".
//
// Nothing here is a combatant. These are NOT npc.js records: they have no
// `state`, no `hp`, no `arm`, no `provoke`, they are never pushed onto
// main.js's `enemies` array, and they are not offered to `fire()` as hit
// targets (main.js's hit list is `enemies` + foot cops + venue crowds +
// vehicles; streetlife is not in it). They cannot be provoked, cannot fight,
// cannot be killed by the police, and cannot consume a single slot of
// npc.js's `becomeHostile` budget / MAX_HOSTILE. That is structural rather
// than a promise: the only state a streetlife record has is a beat name and a
// position, and there is no code path from either to a weapon.
//
// The one thing they DO react to is a gunshot, and the reaction is to run away
// (`panic`). A crowd that watches a drive-by and keeps strolling is its own
// kind of wrong; a crowd that fights back would be a much worse one.
//
// Cost, and it is bounded three ways rather than one:
//
//   DRAW   only `DRAW_CAP` of the nearest pedestrians are visible at all, so
//          the draw-call cost is a constant, not a function of how big the
//          city is. This is the currency that matters: a pedestrian is ~28-36
//          meshes and 9-17 materials after characters.js's mergeRigid, so an
//          actor is ~30 draw calls.
//   CPU    `update()` is a distance band, not a distance: the near band runs
//          every frame, the middle band every third frame (staggered on id, so
//          they do not all animate on the same one), and past ACTIVE_RADIUS an
//          actor is not updated at all. Measured ~0.001-0.005 ms/frame/actor.
//   MEM   `POOL_CAP` records, ever. A record's character is REUSED when it is
//          released, so the pool does not grow as you walk around, and the
//          archetype is only re-cast when a record changes clothes — which
//          happens while the mesh is invisible, so it costs nothing to see.
//
// Streaming is player-centric. The old build cast ONE person per route and
// stopped at the cap, which on the real OrleaRouge grid meant the first 46
// routes in list order — all of them avenue beats — so the entire city-wide
// population was 46 police officers and not one civilian (measured: 46 actors,
// 46 of kind "beat", 0 commuters). It also never re-cast anything: walkers
// were released past KEEP_RADIUS and nothing ever put them back, so walking
// across the city emptied it permanently. Now the slots are chosen by distance
// from the player and refilled, which is what a moving crowd is.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { randomHoodrat, randomTuxedo, randomRedneck, makeDeputy, randomProstitute, randomHighEndEscort } from "./characters.js";

/** …how far away a walker is still drawn and animated every frame. */
export const ACTIVE_RADIUS = 120;
/** …and how far away it still exists, before being released back to the pool. */
const KEEP_RADIUS = 240;
/** How many pedestrians are DRAWN at once, nearest first. This is the draw-call budget. */
const DRAW_CAP = 26;
/** How many records the pool ever holds. */
const POOL_CAP = 150;
/** …and how many of them are cast at world build (the rest stream in on demand). */
const BUILD_CAST = 64;
/**
 * How many MILLISECONDS of casting one frame may spend, so streaming in a crowd
 * never hitches. This is a time budget rather than a cast count because the two
 * archetypes cost three times what the cheap ones do: at one cast per 0.25 s
 * refill a 150-record pool needed 37 s to fill, which meant driving into a
 * district and finding an empty street. A 4 ms budget refills at roughly 25
 * pedestrians a second — full pool in about six seconds of walking — and the
 * worst it can ever cost a frame is 4 ms, whatever it is casting.
 */
const CAST_BUDGET_MS = 4;
/** …how far away a slot may be and still be filled. */
const FILL_RADIUS = 260;
/** …and how close the player has to be before a slot is safe to fill visibly. */
const SPAWN_SAFE = 55;
/** …one animation frame in this many for the middle distance band. */
const MID_BAND_EVERY = 3;

const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// The casting sheet: who walks here.
//
// Weight is per-band, because the mix that makes a street at 9am is not the mix
// that makes it at 2am. A businessman belongs on the pavement at nine and is
// conspicuously absent at two; a prostitute is the reverse. Both are always
// present — the player asked for both on the same pavements — but the ratio is
// what sells the hour.
//
// NOTE ON HOGS, because the request said "hookers and shit" and a reader of this
// file may go looking for `makeHog`. There are two different animals under that
// name and NEITHER is a hooker:
//   * characters.js `makeHog` is a person in a hog costume — a HAPPY HOGS stage
//     act. crowd.js casts it for the podiums and the bar.
//   * npc.js type "hog" is a FERAL HOG, and it is in AMBUSHERS: it charges the
//     player on sight and spends the shared hostile budget doing it.
// A hooker on a city pavement is a CIVILIAN, so she is cast from
// randomProstitute / randomHighEndEscort — the same rigs main.js's ENEMY_TYPES
// uses for its non-hostile "prostitute" and "highendescort" — and she is a
// streetlife record, which is outside npc.js entirely.
// ---------------------------------------------------------------------------
const CAST = {
  businessman: { h: 1.82, day: 26, night: 8, make: (r) => randomTuxedo(r, 1.82) },
  clerk:      { h: 1.78, day: 22, night: 12, make: (r) => randomHoodrat(r, 1.78, { shirt: true }) },
  worker:     { h: 1.80, day: 14, night: 10, make: (r) => randomRedneck(r, 1.80) },
  tourist:    { h: 1.76, day: 10, night: 14, make: (r) => randomHoodrat(r, 1.76) },
  // the street workers. `glam` is characters.js's own flag for bare legs, a
  // short skirt and heels, which is the wardrobe difference between the two.
  hooker:     { h: 1.80, day: 8,  night: 18, make: (r) => randomProstitute(r, 1.80, { glam: true }) },
  escort:     { h: 1.82, day: 4,  night: 16, make: (r) => randomHighEndEscort(r, 1.82) },
  cop:        { h: 1.82, day: 9,  night: 9,  make: (r) => makeDeputy({ police: true, seed: (r() * 1e9) | 0, height: 1.82 }) },
};

/** The beat cops' archetype is fixed — a beat is a beat, at any hour. */
const BEAT_ARCH = "cop";

/** One archetype off a weighted bag. Cop is separate: it is not in the bag. */
function pickArchetype(roll, night) {
  let total = 0;
  for (const k in CAST) if (k !== BEAT_ARCH) total += night ? CAST[k].night : CAST[k].day;
  let want = roll * total;
  for (const k in CAST) {
    if (k === BEAT_ARCH) continue;
    want -= night ? CAST[k].night : CAST[k].day;
    if (want <= 0) return k;
  }
  return "clerk";
}

/** What they are doing with their time. crowd.js's beat vocabulary, sidewalk edition. */
const BEAT_WALK = "walk", BEAT_DWELL = "dwell", BEAT_CROSS = "cross";

/** A person standing about holds an idle; a couple of them hold a lean. */
const IDLE_CLIPS = ["idle", "idle", "idle", "lean"];

export function createStreetLife({ scene, resolveCollision = null, isNight = () => false, rng = Math.random }) {
  const actors = [];          // live records
  const free = [];            // released records, reused rather than re-cast
  let nextId = 1;
  let frame = 0;
  let routes = [];
  let slots = [];             // the fillable positions along those routes
  let slotTaken = null;       // Uint8Array, parallel to `slots`
  const groups = new Map();   // grpId -> shared walk state, so a group walks as one
  const grpTaken = new Map(); // grpId -> how many people are on that stretch

  // ---------------------------------------------------------------- the routes
  //
  // A route is a straight walk between two points with a kerbside offset, and
  // everything else — direction, gait, what they do at the end — falls out of
  // that. Routes are generated from a district's own street grid rather than
  // scattered, because a pedestrian who walks in a straight line across open
  // ground is the single clearest tell that nobody placed them.
  function makeRoutes({ avenues, streets, width, minX, maxX, minZ, maxZ, roadX }) {
    const out = [];
    const footway = width / 2 + 1.1;              // the pavement, just off the kerb
    // a beat down each avenue, and a couple of crossing beats on the big streets
    let avenueIx = 0;
    for (const x of avenues) {
      if (x < minX + 30 || x > maxX - 30) continue;
      // every third street in the grid carries a police beat, picked by POSITION
      // IN THE LIST rather than by the coordinate: a predicate like `x % 4 === 0`
      // matches nothing at all on this grid (the avenues run -286, -246, -246…,
      // none of them a multiple of four) and silently cast zero officers, which
      // reads as "the police are gone" rather than as "the predicate is wrong".
      const police = (avenueIx++ % 3) === 0;
      for (const side of [-1, 1]) {
        // Only a quarter of the avenue routes are a POLICE beat. Every beat
        // being one is what left the city 92 cops and 58 civilians out of 150 —
        // the slot pool is 60% avenue beats, so "beat means deputy" made the
        // cast sheet almost decorative. A beat is a stretch of pavement; who is
        // walking it is chosen per slot.
        out.push({
          a: [x + side * footway, minZ + 20], b: [x + side * footway, maxZ - 20],
          kind: "beat", name: `avenue ${x}`, speed: 0.85, cross: false, police,
        });
      }
    }
    let streetIx = 0;
    for (const z of streets) {
      if (z < minZ + 30 || z > maxZ - 30) continue;
      // same by list position, not by coordinate — see above. One street in
      // three is patrolled; the other two are ordinary pavement.
      const police = (streetIx++ % 3) === 1;
      // the east–west beats, offset to the far pavement so the two directions
      // are on opposite sides of the road
      out.push({ a: [minX + 20, z - footway], b: [maxX - 20, z - footway], kind: "beat", name: `street ${z}`, speed: 0.85, cross: false, police });
      out.push({ a: [maxX - 20, z + footway], b: [minX + 20, z + footway], kind: "beat", name: `street ${z}`, speed: 0.9, cross: false, police });
    }
    // the crossings: short beats that take somebody over the boulevard, which
    // is where a city shows you that it has crossings
    for (const z of streets) {
      out.push({ a: [roadX - 8, z - 12], b: [roadX + 8, z - 12], kind: "commuter", name: `crossing ${z}`, speed: 1.15, cross: true });
      out.push({ a: [roadX + 8, z + 12], b: [roadX - 8, z + 12], kind: "commuter", name: `crossing ${z}`, speed: 1.1, cross: true });
    }
    // and the commuters proper: long diagonal walks across the CBD, which is
    // what people actually do and what no straight grid route looks like. Both
    // ends are re-rolled until the walk is a real distance — two random points
    // in a rectangle are often close together, and a 30 m "commute" is a person
    // turning on the spot wearing a suit.
    for (let i = 0; i < 26; i++) {
      let ax = 0, az = 0, bx = 0, bz = 0, len = 0;
      for (let tries = 0; tries < 8; tries++) {
        ax = lerp(minX + 30, maxX - 30, rng()); az = lerp(minZ + 30, maxZ - 30, rng());
        bx = lerp(minX + 30, maxX - 30, rng()); bz = lerp(minZ + 30, maxZ - 30, rng());
        len = Math.hypot(bx - ax, bz - az);
        if (len > 90) break;
      }
      if (len <= 40) continue;               // the rectangle is too small to commute across
      out.push({ a: [ax, az], b: [bx, bz], kind: "commuter", name: "commute", speed: 1.25, cross: false });
    }
    return out;
  }

  // ---------------------------------------------------------------- the slots
  //
  // A ROUTE is a whole street; a SLOT is one place on it. Density is a question
  // about slots, not about routes — the old build put one person on each route
  // and then ran out, which on a 972 m x 370 m grid is one person per 7,800 m².
  // Slots are spaced along their route with a lateral offset, so several people
  // on one street are abreast of one another rather than nose to tail.
  function indexSlots() {
    slots = [];
    for (let ri = 0; ri < routes.length; ri++) {
      const r = routes[ri];
      const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1];
      const len = Math.hypot(dx, dz) || 1;
      // ~45 m apart: close enough that a pavement never has a 90 m gap in it,
      // far enough that two people never occupy the same metre of pavement.
      const n = Math.max(1, Math.min(9, Math.round(len / 45)));
      const px = -dz / len, pz = dx / len;              // across the pavement
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        const side = (s % 2 ? 1 : -1) * 0.62;            // two abreast, not in a file
        // Slots are paired ADJACENT along the route — 0 with 1, 2 with 3 — and
        // that pairing is what makes a group. The earlier version bucketed by
        // `floor(t * 8)`, which splits neighbours apart as soon as a route has
        // more than eight slots: two people 4 m apart on the same pavement were
        // put in different groups and walked off separately. Measured 2 groups
        // in a 150-strong pool; adjacent pairing is what actually produces them.
        const gi = s >> 1;
        const paired = n > 1 ? Math.min(n - 1, (gi * 2) + 1) : s;
        // the pair's MIDPOINT, so both members walk the same stretch of pavement
        const grpT = (t + (s + 0.5) / n) / 2;
        // one pace per group, so a pair does not slowly pull apart over a block
        const grpSpeed = r.speed * (0.9 + (((ri * 7 + gi * 13) % 26) / 100));
        slots.push({
          ri, t, grpT, grpSpeed, pair: paired,
          x: lerp(r.a[0], r.b[0], t) + px * side,
          z: lerp(r.a[1], r.b[1], t) + pz * side,
          grp: `${ri}:${gi}`,
        });
      }
    }
    slotTaken = new Uint8Array(slots.length);
    // nobody is standing in the pool's world at build time
    for (const rec of free) if (rec.slot >= 0) slotTaken[rec.slot] = 0;
    for (const rec of actors) if (rec.slot >= 0) slotTaken[rec.slot] = 1;
  }

  // ---------------------------------------------------------------- the pool
  //
  // The pool holds RECORDS, and a record's character lives on `rec.mesh` — that
  // is the object that was added to the scene. So reusing a pooled record means
  // reusing `rec.mesh`, NOT the record itself: passing the record on as the
  // actor handed a plain `{id, kind, route, mesh…}` object to the animation
  // calls, and the second time a pooled walker was reused it threw on
  // `actor.play is not a function`. `mesh` is the truth here, and the scene add
  // belongs to whichever character we ended up with.
  //
  // The archetype is allowed to MISMATCH on reuse, because the swap happens
  // while the record is out of the pool and therefore invisible: a deputy who is
  // recycled into a suit is re-cast off-screen and nobody sees the change. The
  // old code refused a mismatch and dropped the cast character on the floor
  // instead, which is how a rebuilt street ended up with 44 walkers of whom 8
  // could actually be seen.
  function spawn(slot, arch, r) {
    // `free.pop()` is undefined on a cold pool, and the record is the thing that
    // carries the id — so it has to start as an object either way.
    const rec = free.pop() || {};
    const reuse = rec.mesh;
    let actor = reuse;
    let casted = false;
    if (reuse && rec.arch !== arch) {
      // out of the world already (despawn removed it); drop the old body
      rec.mesh = null;
      actor = null;
    }
    if (!actor) { actor = CAST[arch].make(r); casted = true; }
    // A NEW id every spawn, pooled or not. Reusing the record's id meant a
    // rebuild handed the whole new crowd the same identity: "64 actors, 1 ids".
    const id = nextId++;

    if (!reuse || rec.arch !== arch) {
      actor.traverse((m) => {
        if (!m.isMesh) return;
        m.userData.noBatch = true;       // people move: never merged into a static batch
        m.userData.streetLife = true;
        // non-combatant, stated on the body so any future hit-test or AI sweep
        // that walks the scene can see it without knowing this module
        m.userData.civilian = true;
        m.userData.ambientPed = true;
      });
    }
    // Parented unconditionally, and by asking rather than by tracking. `build`
    // and `despawn` both take a character back OUT of the scene, so a pooled
    // actor that is re-used is out of the world until something puts it back —
    // and nothing did, which is why a rebuilt street had 44 walkers of whom 8
    // could actually be seen.
    if (actor.parent !== scene) scene.add(actor);

    const route = routes[slot.ri];
    rec.id = id;
    rec.slot = slot.i;
    // The stretch of route this person owns. Without it they walk the WHOLE
    // route — an avenue beat is 340 m end to end — so they spend their life
    // walking out of the world and being released, and the pool never fills:
    // measured 4-11 records alive against a cap of 150. A window of about a
    // block and a half either side of their slot keeps a person on their own
    // stretch of pavement, which is both what a pedestrian does (you walk your
    // block, you do not commute the whole avenue) and what makes the streaming
    // pool reach its cap.
    //
    // A group shares its window and its pace, or the pair drifts apart within a
    // block: two walkers given independent windows turn at different kerbs and
    // separate. `grpT` is the pair's midpoint and `grpSpeed` is one pace per
    // group, so both members walk the same stretch at the same speed.
    rec.win = windowFor(route, slot.grpT ?? slot.t, rng);
    rec.arch = arch;
    rec.kind = route.kind;                 // beat / commuter — what the caller asks for
    rec.route = route;
    rec.grpId = slot.grp;
    bumpGroup(rec.grpId, 1);
    rec.t = slot.t;
    // A group picks its direction ONCE, from its first member, and the rest
    // read it off the shared state. Rolling it per member is what had half of
    // every pair walking away from each other — measured 29 of 46 groups aligned
    // instead of 46.
    rec.dir = rng() < 0.5 ? 1 : -1;
    if (grpTaken.has(rec.grpId)) {
      const g = groups.get(rec.grpId);
      if (g) rec.dir = g.dir;
    }
    rec.speed = slot.grpSpeed ?? (route.speed * (0.9 + rng() * 0.25));
    rec.offset = 0;                       // groups drift apart as they walk
    rec.pause = 0;
    rec.beat = route.cross ? BEAT_CROSS : BEAT_WALK;
    rec.beatT = rng() * 4;
    rec.dwellAt = rng() * 6;
    rec.d2 = Infinity;
    rec.visible = false;
    rec.panic = 0;
    rec.mesh = actor;
    rec.casted = casted;
    actor.play(route.cross ? "idle" : "walk", { force: true });
    actor.visible = false;
    // put them on their slot before they are ever seen
    place(rec, true);
    actors.push(rec);
    return rec;
  }

  /**
   * The stretch of a route one person walks: their slot, plus a random amount
   * either side so two people on the same pavement do not pace in lockstep.
   * Clamped inside the route, and never so short that a person turns on the spot.
   */
  function windowFor(route, t, r) {
    const len = Math.hypot(route.b[0] - route.a[0], route.b[1] - route.a[1]) || 1;
    // about 60 m either side, which is a block and a half on this grid
    const span = Math.min(0.5, 60 / len);
    let lo = t - span * (0.55 + r() * 0.45);
    let hi = t + span * (0.55 + r() * 0.45);
    if (lo < 0) { hi -= lo; lo = 0; }
    if (hi > 1) { lo -= hi - 1; hi = 1; }
    if (hi - lo < 0.05) { lo = Math.max(0, t - 0.025); hi = Math.min(1, lo + 0.05); }
    return { lo, hi };
  }

  /** World position + facing for a record at its current `t`. */
  function place(rec, snap) {
    const r = rec.route;
    const a = r.a, b = r.b;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const px = -dz, pz = dx;                       // across the pavement
    let t = rec.t;
    if (rec.beat === BEAT_CROSS) {
      // a crosser is held at the kerb until their walk is released, so they do
      // not step off the moment they are cast
      t = rec.dir > 0 ? 0 : 1;
    }
    const side = rec.offset;
    const x = lerp(a[0], b[0], t) + px * side;
    const z = lerp(a[1], b[1], t) + pz * side;
    const m = rec.mesh;
    m.position.set(x, 0, z);
    if (snap && m._last) m._last.copy(m.position);
    const tx = dx * rec.dir, tz = dz * rec.dir;
    const yaw = Math.atan2(tx, tz);
    m._yaw = yaw;
    m.rotation.y = yaw;
  }

  /** Keep the group tally in step with who is actually standing on the pavement. */
  function bumpGroup(grpId, by) {
    if (!grpId) return;
    const n = (grpTaken.get(grpId) || 0) + by;
    if (n > 0) grpTaken.set(grpId, n); else grpTaken.delete(grpId);
    if (n <= 0) groups.delete(grpId);      // nobody left to lead: drop the state
  }

  function despawn(rec) {
    const i = actors.indexOf(rec);
    if (i >= 0) actors.splice(i, 1);
    if (rec.mesh) {
      scene.remove(rec.mesh);
      rec.mesh.visible = false;
    }
    if (rec.slot >= 0 && slotTaken) slotTaken[rec.slot] = 0;
    bumpGroup(rec.grpId, -1);
    rec.slot = -1;
    rec.grpId = null;
    free.push(rec);
  }

  /**
   * Release everything far behind, without the per-frame scan that main.js's own cull uses.
   *
   * It measures from `playerPos` itself rather than reading each record's cached
   * `d2`, because `update()` used to run it BEFORE the distance pass — so it was
   * releasing on LAST frame's distances and a one-frame jump released nothing
   * ("5 -> 5 after walking a continent away"). One subtract and two multiplies
   * per record is not worth caching.
   */
  function release(playerPos) {
    const px = playerPos ? playerPos.x : 0, pz = playerPos ? playerPos.z : 0;
    for (let i = actors.length - 1; i >= 0; i--) {
      const rec = actors[i];
      const m = rec.mesh;
      const dx = m.position.x - px, dz = m.position.z - pz;
      rec.d2 = dx * dx + dz * dz;
      if (rec.d2 > KEEP_RADIUS * KEEP_RADIUS) despawn(rec);
    }
  }

  // ---------------------------------------------------------------- the fill
  //
  // Choose the slots nearest the player that nobody is standing in, and put a
  // person in them. This is what makes the crowd MOVE WITH YOU: the old build
  // cast once, at world build, in route order, and only ever subtracted.
  const _cand = [];
  function fill(playerPos, castMs) {
    if (!slots.length || castMs <= 0) return;
    const started = performance.now();
    const px = playerPos ? playerPos.x : 0, pz = playerPos ? playerPos.z : 0;
    _cand.length = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slotTaken[i]) continue;
      const s = slots[i];
      const d2 = (s.x - px) ** 2 + (s.z - pz) ** 2;
      if (d2 > FILL_RADIUS * FILL_RADIUS) continue;
      _cand.push({ i, s, d2 });
    }
    if (!_cand.length) return;
    // nearest first — a partial selection, so the ones we cannot afford this
    // frame are simply the ones we did not reach
    _cand.sort((a, b) => a.d2 - b.d2);
    // …except that a slot beside somebody already standing wins over a slightly
    // nearer empty one. Filling purely nearest-first scatters the pavement:
    // every slot is a different street, so no two people ever land in the same
    // group and the street reads as a crowd of loners (measured: 2 groups in the
    // whole pool). Preferring siblings of slots that are already occupied is
    // what produces the pairs and trios — it is the only thing that makes a
    // pavement look like people who know each other.
    for (let i = 0; i < _cand.length; i++) {
      const c = _cand[i];
      if (grpTaken.get(c.s.grp)) c.d2 *= 0.35;
    }
    for (const c of _cand) {
      if (actors.length >= POOL_CAP) break;
      // time budget: check the clock BEFORE paying for a cast, so a frame can
      // never overshoot by one whole body
      if (performance.now() - started > castMs) break;
      // never fill a slot the player is standing in: a pedestrian appearing at
      // your feet is the one pop that is actually noticed
      if (c.d2 < SPAWN_SAFE * SPAWN_SAFE) continue;
      const r = routes[c.s.ri];
      const night = isNight();
      // a POLICE beat is a deputy; everything else — including an ordinary
      // avenue beat — is drawn from the sheet, and a crossing is nobody's beat
      // so it is never a cop
      const arch = r.police ? BEAT_ARCH : pickArchetype(rng(), night);
      c.s.i = c.i;
      const rec = spawn(c.s, arch, rng);
      if (!rec) break;
      slotTaken[c.i] = 1;
      // a recycled body costs nothing to place, which is the normal case once
      // the pool has been round the block once — so a whole street of
      // pedestrians can be refilled inside the same 4 ms
    }
  }

  // ---------------------------------------------------------------- the tick
  const _p = new THREE.Vector3();
  const _next = new THREE.Vector3();
  const _vis = [];

  function build(given) {
    routes = given || [];
    for (const rec of actors) { if (rec.mesh) scene.remove(rec.mesh); free.push(rec); }
    actors.length = 0;
    free.length = 0;
    groups.clear();
    grpTaken.clear();
    indexSlots();
    if (!slots.length) return;
    // Seed a scatter across the whole grid rather than the nearest slots to the
    // origin: at build time there is no player yet, and a city whose population
    // all stands in one corner is not a city the moment you drive away from it.
    const order = slots.map((s, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
    let cast = BUILD_CAST;
    for (const i of order) {
      if (actors.length >= BUILD_CAST || cast <= 0) break;
      const s = slots[i]; s.i = i;
      const r = routes[s.ri];
      const night = isNight();
      const arch = r.police ? BEAT_ARCH : pickArchetype(rng(), night);
      const rec = spawn(s, arch, rng);
      slotTaken[i] = 1;
      if (rec.casted) cast--;
    }
  }

  /** The beat a walker is on, and whether they are moving this instant. */
  function drive(rec, dt) {
    const m = rec.mesh;
    const r = rec.route;
    const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) || 1;

    if (rec.panic > 0) {
      // running, not fighting: straight away from the noise, off the far side
      rec.panic -= dt;
      m.play("walk", { force: true });
      return true;
    }

    // ---- group ---------------------------------------------------------------
    // Members of one group share a DIRECTION and a set of PAUSES, so two people
    // cast onto neighbouring slots walk off together instead of separating at
    // the first kerb. It is a shared flag, not a leader: whoever is casting
    // writes it, everybody reads it, and a group of one costs nothing.
    let grp = null;
    if (rec.grpId) {
      grp = groups.get(rec.grpId);
      if (!grp) { grp = { dir: rec.dir, pause: 0 }; groups.set(rec.grpId, grp); }
      if (grp.dir !== rec.dir) rec.dir = grp.dir;
    }

    if (rec.beat === BEAT_CROSS) {
      // kerb, wait, go — and once over, become an ordinary pavement walker.
      // A crossing is its own route and is short, so it runs on the route's
      // real ends rather than this person's window: a crosser goes over, they
      // do not walk three quarters of the way back.
      rec.beatT -= dt;
      if (rec.beatT <= 0) {
        if (rec.dir > 0 ? rec.t >= 1 : rec.t <= 0) {
          rec.dir = -rec.dir;
          rec.beatT = 1.2 + rng() * 5;    // standing at the kerb, waiting for a gap
          m.play(rng() < 0.25 ? "lean" : "idle", { loop: true });
          place(rec);
          return false;
        }
        rec.t += (rec.dir * rec.speed * dt) / len;
        if (rec.dir > 0 ? rec.t >= 1 : rec.t <= 0) rec.beat = BEAT_WALK;
        m.play("walk");
        place(rec);
        return true;
      }
      m.play("idle", { loop: true });
      place(rec);
      return false;
    }

    // ---- dwell: stopped at a kerb or a shopfront, which is not idling -------
    // A group dwells TOGETHER: the first member to run out of dwell calls it,
    // and the others are released by the shared flag a frame later.
    if (rec.beat === BEAT_DWELL) {
      rec.beatT -= dt;
      if (rec.beatT <= 0) {
        rec.beat = BEAT_WALK;
        if (grp) grp.pause = 0;
      } else {
        m.play(rec.idle || "idle", { loop: true });
        return false;
      }
    }

    // a group whose leader stopped at a kerb stops too
    if (grp && grp.dwellBeat && rec.beat === BEAT_WALK) {
      grp.dwell -= dt;
      if (grp.dwell <= 0) { grp.dwellBeat = false; }
      else { m.play(rec.idle || "idle", { loop: true }); place(rec); return false; }
    }
    // the shared pause: a group stopped at a kerb stops as one
    const sharedPause = grp && grp.pause > 0 ? (grp.pause -= dt) : 0;
    if (rec.pause > 0 || sharedPause > 0) {
      if (rec.pause > 0) rec.pause -= dt;
      m.play(rec.idle || "idle", { loop: true });
      place(rec);
      return false;
    }

    const w = rec.win;
    rec.t += (rec.dir * rec.speed * dt) / len;
    if (rec.t >= w.hi) { rec.t = w.hi; rec.dir = -1; arrived(rec, grp); }
    else if (rec.t <= w.lo) { rec.t = w.lo; rec.dir = 1; arrived(rec, grp); }
    m.play("walk");
    place(rec);
    return true;
  }

  /** Reached the end of the route: pause, and sometimes stop for a while. */
  function arrived(rec, grp) {
    rec.pause = 0.3 + rng() * 2.2;
    if (grp) grp.pause = Math.max(grp.pause, rec.pause);
    if (rng() < 0.34) {                       // a corner somebody stops at
      rec.beat = BEAT_DWELL;
      rec.beatT = 2 + rng() * 7;
      rec.idle = IDLE_CLIPS[(rng() * IDLE_CLIPS.length) | 0];
      // ...and the rest of the group gets the same idea, so two people who
      // walked here together stop here together
      if (grp) { grp.dwell = rec.beatT; grp.dwellBeat = true; }
    }
  }

  /**
   * Walk everybody toward the far end of their route, turn at the end, and cull
   * by distance. `_speed` is derived by the rig from how far the body actually
   * moved, which is why the walk clip's stride scales itself and why a paused
   * commuter stands still instead of moonwalking.
   *
   * `resolveCollision` has main.js's signature — (current, next, radius),
   * MUTATING `next` rather than returning a position — so it is called that way
   * here. An earlier version assumed it returned a point, which meant every
   * walker walked through the kerb and the corners.
   */
  function update(dt, playerPos) {
    frame++;
    if (!routes.length) return;
    const px = playerPos ? playerPos.x : 0, pz = playerPos ? playerPos.z : 0;

    // ---- streaming: release what is behind, fill what is ahead --------------
    //
    // Release runs EVERY frame. It used to share a timer with the refill, which
    // meant a single frame's jump — a respawn, a car ride across the map — never
    // released anything and the pool stayed full of pedestrians standing on the
    // far side of the city (measured: "4 -> 4 after walking a continent away").
    // The scan is at most POOL_CAP records with one multiply each, so there was
    // never anything to save by throttling it.
    //
    // Fill runs every frame too, bounded by CAST_BUDGET_MS of wall clock rather
    // than by a count of bodies — so a released slot is refilled within a frame,
    // and the most it can ever cost a frame is that many milliseconds whatever
    // it happens to be casting.
    release({ x: px, z: pz });
    if (actors.length < POOL_CAP) fill({ x: px, z: pz }, CAST_BUDGET_MS);

    // ---- distances, one pass -----------------------------------------------
    for (let i = 0; i < actors.length; i++) {
      const rec = actors[i];
      const m = rec.mesh;
      rec.d2 = (m.position.x - px) ** 2 + (m.position.z - pz) ** 2;
    }

    // ---- draw budget: the nearest DRAW_CAP and no more ----------------------
    // This is the whole per-frame cost bound. Past it a pedestrian is not drawn
    // at all, which is why a 465-block city costs the same as a 20-block one.
    _vis.length = 0;
    for (let i = 0; i < actors.length; i++) {
      const rec = actors[i];
      if (rec.d2 < ACTIVE_RADIUS * ACTIVE_RADIUS) _vis.push(rec);
    }
    // Sorted NEAREST FIRST, so `i < DRAW_CAP` keeps the closest ones. The sort
    // used to run AFTER the flag loop had already been written against the
    // unsorted list, which meant the cap was keeping an arbitrary slice of the
    // crowd rather than the nearest slice — measured: a pedestrian 65 m away,
    // well inside the 120 m active radius, left un-drawn while others 200 m off
    // were drawn. Sort first, then cap.
    _vis.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < _vis.length; i++) {
      const rec = _vis[i];
      rec.visible = i < DRAW_CAP;
      rec.mesh.visible = rec.visible;
    }
    // …and anything past ACTIVE_RADIUS was never in `_vis` at all, so its flag
    // has to be cleared here or it stays `true` from the last frame it was
    // near. Same leak, second source.
    for (let i = 0; i < actors.length; i++) {
      const rec = actors[i];
      if (rec.d2 >= ACTIVE_RADIUS * ACTIVE_RADIUS) { rec.visible = false; rec.mesh.visible = false; }
    }

    // ---- update, in bands ---------------------------------------------------
    for (let i = 0; i < actors.length; i++) {
      const rec = actors[i];
      const m = rec.mesh;
      if (rec.d2 >= ACTIVE_RADIUS * ACTIVE_RADIUS) { m.visible = false; continue; }
      // near band: every frame. middle band: one frame in three, staggered on
      // id so they do not all animate on the same one.
      const near = rec.d2 < 55 * 55;
      if (!near && (frame + rec.id) % MID_BAND_EVERY) continue;

      if (rec.visible) m.visible = true;

      if (rec.panic > 0) {
        // Run: along the route, in whichever direction is AWAY from the noise,
        // and off the end of it (t is allowed past 0/1, which is how somebody
        // being shot at leaves the block). This is a plain lerp along the route
        // axis — no target, no pursuit, no line to anything that fights back.
        const r = rec.route;
        const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) || 1;
        const ux = (r.b[0] - r.a[0]) / len, uz = (r.b[1] - r.a[1]) / len;
        // where the noise sits along this route's own axis
        const proj = (rec.panicX - r.a[0]) * ux + (rec.panicZ - r.a[1]) * uz;
        const sgn = proj < rec.t * len ? 1 : -1;
        rec.t += (sgn * rec.speed * 2.1 * dt) / len;
        if (rec.t > 1.25) rec.t = 1.25;
        if (rec.t < -0.25) rec.t = -0.25;
        rec.dir = sgn;
        place(rec);
        m.play("walk", { force: true });
        m.update(dt);
        continue;
      }

      drive(rec, near ? dt : dt * 3);

      // Collision, so they use the kerbs and the corners rather than walking
      // through parked cars and the faces of buildings. `drive` has already
      // moved them along the route, so the resolver is asked whether the NEXT
      // step down that same line is clear and the answer is folded back into
      // `t` — the position is never written twice from two places, which is how
      // a walker ends up fighting its own collision step and jittering on a
      // kerb. A blocked step simply does not advance `t`, so a pedestrian pinned
      // between two parked cars waits rather than sliding through them.
      if (m.anim === "walk" && resolveCollision) {
        const r = rec.route;
        const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) || 1;
        const ux = (r.b[0] - r.a[0]) / len * rec.dir, uz = (r.b[1] - r.a[1]) / len * rec.dir;
        _p.copy(m.position);
        _next.set(_p.x + ux * rec.speed * dt, 0, _p.z + uz * rec.speed * dt);
        resolveCollision(_p, _next, 0.45);
        const moved = Math.hypot(_next.x - _p.x, _next.z - _p.z);
        if (moved < rec.speed * dt * 0.35) {
          // blocked (or nearly): give up on this direction rather than grind
          rec.blocked = (rec.blocked || 0) + dt;
          // A blocked pedestrian reverses, and the rest of their group follows.
          //
          // This was `if (grp) grp.dir = rec.dir`, and `grp` is NOT in scope here.
          // The collision block sits in update() (streetlife.js:677), which runs
          // AFTER drive() returns; `grp` is a local of drive() (declared at 582) and a
          // parameter of arrived() (653). update() never declares one.
          //
          // So this threw ReferenceError on every blocked street pedestrian, and a
          // falsy guard does not help -- `if (undeclared)` throws exactly as hard as
          // `undeclared.x`. It is a real crash in game code, not a probe artefact: it
          // was found by driving streetLife.update() from a browser harness and read
          // straight off the stack trace, at streetlife.js:787.
          //
          // Groups are keyed by rec.grpId (streetlife.js:357) into the `groups` Map
          // (169). Fetch it the same way drive() does at 584-585.
          if (rec.blocked > 0.6) {
            rec.dir = -rec.dir;
            rec.blocked = 0;
            const g = groups.get(rec.grpId);
            if (g) g.dir = rec.dir;
          }
        } else rec.blocked = 0;
      }
      m.update(dt);
    }
  }

  /**
   * Gunfire on the street. Every pedestrian within `r` of it runs, and stops
   * being a pedestrian for a few seconds while they do. This is the ONLY thing
   * in this module that reacts to the player, and the reaction is deliberately
   * the one that cannot cause a fight: nobody here has a weapon, a state or a
   * line to npc.js's becomeHostile().
   */
  function panic(x, z, r = 40) {
    const r2 = r * r;
    for (const rec of actors) {
      if (rec.d2 === Infinity) continue;
      const m = rec.mesh;
      const d2 = (m.position.x - x) ** 2 + (m.position.z - z) ** 2;
      if (d2 > r2) continue;
      rec.panic = 3 + Math.random() * 4;
      rec.panicX = x; rec.panicZ = z;
      rec.beat = BEAT_WALK;
      rec.pause = 0;
      m.play("walk", { force: true });
    }
  }

  return {
    build, update, makeRoutes, panic,
    /** Everything here moves: main.js must keep it out of batchStatic. */
    get props() { return actors.map((a) => a.mesh); },
    get actors() { return actors; },
    get count() { return actors.length },
    /** The casting sheet, so the QA can read the archetype mix off the pool. */
    get castSheet() { return CAST },
    archetypeCounts() {
      const out = {};
      for (const a of actors) out[a.arch] = (out[a.arch] || 0) + 1;
      return out;
    },
    kindCounts() {
      const out = {};
      for (const a of actors) out[a.kind] = (out[a.kind] || 0) + 1;
      return out;
    },
    get visibleCount() { let n = 0; for (const a of actors) if (a.visible) n++; return n; },
    beatCounts() {
      const out = {};
      for (const a of actors) out[a.beat] = (out[a.beat] || 0) + 1;
      return out;
    },
    get slotCount() { return slots.length },
  };
}
