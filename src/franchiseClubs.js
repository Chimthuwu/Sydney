// ---------------------------------------------------------------------------
// franchiseClubs.js — walk-in Happy Hogs / Billy Jeans / Stoogelets franchise
// interiors.
//
// Three franchises of the Crown Strip's red-light row (human brief,
// 2026-09-29): BILLY JEANS is the gay bar — its dancers are the billys, men
// (characters.js `shirtless`), glitter, heels. HAPPY HOGS is the hog-themed
// show bar — the cast dance IN THE MASKS: pig snout, round ears, two stubby
// pig tails (characters.js `hogMask`), sequins and heels over all of it. The
// commitment is the joke. STOOGELETS is the plain gentlemen's club — regular
// strippers, no theme beyond teal neon and a martini glass on the roof.
//
// Fictional adults (25+) throughout; the bare chest (either build) is the same
// low-poly cylinder-and-spheres bust every clothed NPC already has — no new
// geometry, no anatomical detail beyond what was already there under the top.
// The stage routines and the opt-in private activities are suggestive; the
// back-room night minigame (adultContent.js openNightScene) is naughty rather
// than explicit — its finale is a running censor gag.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { makeHog, makeDancer, randomHoodrat, randomTuxedo, randomHighEndEscort, ADULT_CLIPS } from "./characters.js";
import { beginStageAct, createAct } from "./act.js";

const BRANCHES = Object.freeze({
  hogs: { name: "HAPPY HOGS", price: 80, palette: 0xff4fb3 },
  billy: { name: "BILLY JEANS", price: 80, palette: 0x9ad6ff },
  stoogelets: { name: "STOOGELETS", price: 120, palette: 0x39d98a },
});
const ROUTINE_SECONDS = 3.4;
const ENCORE_SECONDS = 6.5;
const ENCORE_TIP = 10;
// The back-room night (2026-09-29): rooms out back of every franchise. The
// player is led out the back door, pays there, and the night minigame runs.
const NIGHT_PRICE = 250;               // flat across the franchises
const NIGHT_COOLDOWN = 180;            // seconds of game time between nights per club
const NIGHT_REGULAR_DISCOUNT = 0.8;    // a coffee regular gets the room for 80%
// coffee beat (2026-09-28/29): every finished private dance can end in the
// performer's invitation. Staying heals, makes you a regular, and starts a
// per-club cooldown so the beat can't be farmed.
const COFFEE_COOLDOWN = 120;              // seconds of game time between invitations per club
const COFFEE_REGULAR_DISCOUNT = 0.75;     // regulars pay 75% of the posted dance price
const COFFEE_HEAL = 40;
// The house routines. Every cast in a branch changes on the CLUB's clock, not
// its own (see `rec.beat` in register), so the whole stage moves as one — the
// `sync` numbers are eight counts of group choreography that only read as
// choreography if everybody hits them together (characters.js `sync`).
const STAGE_ROUTINES = Object.freeze({
  hogs: ["sync", "twerk", "grind", "sync", "stripTease", "showboat"],
  billy: ["sync", "showboat", "moonwalk", "spin", "footwork", "grind"],
  stoogelets: ["sync", "twerk", "grind", "sync", "stripTease", "flash"],
});
// The explicit half of the house, and how often it comes round. These only run
// when the 18+ gate has been answered (characters.js refuses the clips
// otherwise, and `ADULT_CLIPS` is the list) — so the routine a player sees
// depends on what they answered at the door, which is the whole point of gating
// in the rig rather than in the venue.
const STAGE_ACTS = Object.freeze(["stripTease", "flash", "spreadTease", "stageRub"]);
// The bill, per franchise: nobody queues for the sheet's own chest. STOOGELETS
// is the gentlemen's club the strip is named for and carries the biggest
// billing; the hog dancers are the house speciality and are billed to match
// (human request, 2026-09-30).
const STAGE_BUST = Object.freeze({ hogs: 1.72, stoogelets: 1.6, billy: 1 });
// How full the room is. These branches were three people on a stage in a void:
// a club with nobody in it reads as a set, not as a business, however good the
// dancing is (human request, 2026-09-30). The number is per branch and every
// one of them is only drawn while you are in it.
const PATRONS = 14;
const HOG_COSTUMES = Object.freeze([
  { top: 0xff4fb3, skirt: 0x17131d, heelColor: 0xffd23a },
  { top: 0xffd23a, skirt: 0x4a1747, heelColor: 0x17131d },
  { top: 0x9b27b0, skirt: 0x151923, heelColor: 0x9b27b0 },
]);
const BILLY_COSTUMES = Object.freeze([
  { top: 0xff2e93, skirt: 0x17131d, heelColor: 0xd4af37 },
  { top: 0x2ee6d6, skirt: 0x202030, heelColor: 0x17131d },
  { top: 0xffd23a, skirt: 0x4a1747, heelColor: 0x9b27b0 },
]);
const STOOGE_COSTUMES = Object.freeze([
  { top: 0xff2e6b, skirt: 0x101015, heelColor: 0x39d98a },
  { top: 0xffd23a, skirt: 0x151923, heelColor: 0xff2e6b },
  { top: 0x9ad6ff, skirt: 0x17131d, heelColor: 0x9ad6ff },
]);
// back-room performer names — the marquee personas, one per dancer, stable
const STAGE_NAMES = Object.freeze({
  hogs: ["Porkchop", "Sizzle", "Truffle"],
  billy: ["Brick", "Duke", "Satin"],
  stoogelets: ["Velvet", "Candi", "Roxy"],
});

/** End a performer's stage number early, if she is in one. */
function endStageAct(p) {
  if (!p.act) return;
  p.act.end();
  p.act = null;
  p.actClock = 0;
}

const worldAt = (x, z, lx, lz, rot) => ({
  x: x + Math.cos(rot) * lx + Math.sin(rot) * lz,
  z: z - Math.sin(rot) * lx + Math.cos(rot) * lz,
});

// scratch for hittable(): getWorldPosition writes into this, so the target
// list allocates only the {x,y,z,rec} entries and never a Vector3 per person
// per trigger pull.
const _hittableV = new THREE.Vector3();

/**
 * Nobody goes on a franchise stage unless the rig says they are an adult.
 *
 * This used to be `userData.age = Math.max(25, userData.age || 25)`, which
 * looks like a floor and is not one: it assigns 25 to anything that arrives
 * without an age, so it would "pass" for a character of any age, or no age at
 * all. The rig now carries the age as a fact about the model
 * (characters.js `allowsAdultClip`) and this only checks it.
 */
function assertAdult(actor) {
  const age = actor && actor.userData && actor.userData.age;
  if (typeof age !== "number" || age < 25) {
    // Loud rather than quiet: a performer whose age the rig does not know is a
    // casting bug, and the one place it must never be papered over.
    throw new Error(`franchise stage cast: performer "${actor?.userData?.stageName || "?"}" has no adult age (got ${age})`);
  }
  return age;
}

export function createFranchiseClubs({
  scene, addBlocker = () => {}, state = null, adultContent = null,
  flashObjective = () => {}, syncHUD = () => {}, document: doc = globalThis.document,
  worldTime = null,
  makeAdultHog = makeHog, makeAdultDancer = makeDancer,
  // The floor is built from the ordinary crowd factories, not from the
  // performer ones: a patron is nobody's costume. Injectable for the same
  // reason the cast is — the QA sandbox fakes the actors it cannot draw.
  makePatron = (rng, h, kind) => (kind < 0.55 ? randomHoodrat(rng, h)
    : kind < 0.8 ? randomTuxedo(rng, h) : randomHighEndEscort(rng, h)),
  // The player rig, for the back rooms. A private scene needs two bodies and
  // one of them is you, so this is the same handle the lap-dance cinematic
  // already uses rather than a second way of finding the player.
  getPlayer = () => null,
  scene: worldScene = null,
} = {}) {
  const clubs = [];
  let runtimeState = state, contentGate = adultContent, prompt = null, busy = false;
  let promptEl = null;
  if (doc?.body) {
    promptEl = doc.createElement("div");
    promptEl.id = "franchiseClubPrompt";
    promptEl.style.cssText = "position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:25;background:rgba(10,10,14,.86);color:#f4f1ea;padding:8px 16px;border-radius:8px;font:600 14px/1.4 system-ui,sans-serif;pointer-events:none;";
    promptEl.hidden = true;
    doc.body.appendChild(promptEl);
  }
  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: 0x17131d, roughness: 0.84, name: "club interior wall" }),
    floor: new THREE.MeshStandardMaterial({ color: 0x302d36, roughness: 0.92, name: "club interior floor" }),
    trim: new THREE.MeshStandardMaterial({ color: 0xcac5d4, metalness: 0.35, roughness: 0.46, name: "club interior trim" }),
    stage: new THREE.MeshStandardMaterial({ color: 0x101015, roughness: 0.65, name: "club stage" }),
    bed: new THREE.MeshStandardMaterial({ color: 0x4a1747, roughness: 0.9, name: "back-room sheets" }),
    red: new THREE.MeshStandardMaterial({ color: 0x6e1420, roughness: 0.95, name: "back-room lampshade" }),
    steel: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.7, roughness: 0.42, name: "club lighting truss" }),
    bar: new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.7, name: "club bar" }),
  };
  for (const m of Object.values(mats)) m.userData.gtbRealized = true;

  function box(parent, w, h, d, material, x, y, z) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o;
  }

  // The rooms out back (human request, 2026-09-29): a short corridor off the
  // rear wall opening into one lamp-lit room with a bed, a mirror, and a
  // tip jar that has seen things. Local +z faces the FRONT door, so the
  // annex hangs off local -z; the dancer stage is also at -z, so the annex
  // pushes past the stage's back wall. The rear wall here keeps a gap (the
  // corridor mouth) the same trick the front doorway uses: collision at the
  // townkit shell already leaves only the FRONT door open, and the annex
  // adds its own blockers so nobody walks through walls to reach the rooms.
  function buildBackRooms(root, c, mouthZ = -5.15) {
    const w = 5.5, d = 13;
    // Every local z below is written for a corridor mouth at -5.15 (the branch's
    // own rear wall). `z()` shifts the whole annex so the same room can instead
    // be hung off a HOST venue's rear wall (crownstrip.js), whose depth differs.
    const z = (lz) => lz + (mouthZ + 5.15);
    const floor = box(root, w, 0.08, d, mats.floor, 0, 0.02, z(-5.15 - d / 2));
    floor.name = "backroom floor";
    // corridor walls (narrow: it reads as a hallway, not a room)
    box(root, 0.35, 3.4, 5.5, mats.wall, -1.6, 1.7, z(-7.9));
    box(root, 0.35, 3.4, 5.5, mats.wall, 1.6, 1.7, z(-7.9));
    // the room: 5.5 x 7.5, walls all round but the corridor mouth
    box(root, 0.35, 3.4, 7.5, mats.wall, -2.75, 1.7, z(-12.35));
    box(root, 0.35, 3.4, 7.5, mats.wall, 2.75, 1.7, z(-12.35));
    box(root, 5.5, 3.4, 0.35, mats.wall, 0, 1.7, z(-16.05));
    // the bed, the mirror over it, the red lamp, the jar
    box(root, 2.4, 0.5, 4.2, mats.bed, 0, 0.3, z(-14.2));
    box(root, 0.7, 0.35, 0.5, mats.trim, 0, 0.7, z(-15.9));       // pillows, more or less
    const mirror = box(root, 2.6, 1.8, 0.08, new THREE.MeshStandardMaterial({ color: 0x9fb6c9, roughness: 0.05, metalness: 1, name: "back-room mirror" }), 0, 2.0, z(-15.95));
    mirror.userData.noBatch = true;
    const lamp = box(root, 0.5, 0.6, 0.5, mats.red, -2.2, 1.4, z(-14.0));
    lamp.name = "back-room lamp";
    const jar = box(root, 0.4, 0.5, 0.4, new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.4, metalness: 0.3, name: "tip jar" }), 2.2, 0.55, z(-14.0));
    jar.name = "back-room tip jar";
    // where the player stands to interact, and where the dancer waits
    //
    // BOTH forms are kept, and the local one is the one that matters. `update`
    // works in the club's own frame — `lx`/`lz` are the player position rotated
    // into it — and the test used to compare those against
    // `backStand.x - c.x`, which is the stand point in WORLD axes. Those are the
    // same only when the club faces due north. Every other club had its prompt
    // fire somewhere off to one side, so the back rooms were unreachable: you
    // could stand in the corridor and nothing would ever offer to open the
    // door. (human report, 2026-10-01)
    c.backStandLocal = { lx: 0, lz: z(-9.5) };
    c.backSpotLocal = { lx: 0, lz: z(-12.5) };
    c.backStand = worldAt(c.x, c.z, 0, z(-9.5), c.rot);
    c.backSpot = worldAt(c.x, c.z, 0, z(-12.5), c.rot);
    // the bed the couple scenes are staged on, in the same local frame
    c.bedLocal = { lx: 0, lz: z(-14.2) };
    // collision: flank the corridor mouth, line the room sides and far wall
    for (const s of [-1, 1]) { const p = worldAt(c.x, c.z, s * 2.2, z(-6.6), c.rot); addBlocker(p.x, p.z, 1.0); }
    for (const s of [-1, 1]) for (const lz of [-9.5, -12, -15]) { const p = worldAt(c.x, c.z, s * 3.3, z(lz), c.rot); addBlocker(p.x, p.z, 1.1); }
    const far = worldAt(c.x, c.z, 0, z(-16.6), c.rot); addBlocker(far.x, far.z, 1.3);
  }

  // ---- the lighting rig ----------------------------------------------------
  // A room this size used to be lit by one screen and whatever the neon threw
  // through the door, which is why it read as a set with people in it. What a
  // real club has that this did not is LIGHT THAT MOVES: a truss of par cans
  // sweeping the floor, a laser fan crossing over the crowd, and both of them
  // on a different clock from the dancers, so the room is never quite in sync
  // with the act. None of it is a real light — the pooled spot that actually
  // illuminates the room is the venue's own — these are emissive geometry with
  // additive blending, so the cost is a handful of draw calls.
  const LASER_COLOURS = [0x39d98a, 0xff2e6b, 0x2ee6d6, 0x9ad6ff, 0xffe066];
  const bottleMats = new Map(LASER_COLOURS.map((c) => [c, beamMat(c, 1)]));
  const bottleMat = (c) => bottleMats.get(c) || bottleMats.values().next().value;
  function buildLightRig(root, rec) {
    const g = new THREE.Group();
    g.position.set(0, 3.3, 0);
    root.add(g);
    // the truss: two chords and the diagonal between them, all thin
    for (const y of [0, 0.45]) {
      const chord = new THREE.Mesh(new THREE.BoxGeometry(19.0, 0.06, 0.06), mats.steel);
      chord.position.y = y;
      g.add(chord);
    }
    for (let i = -5; i <= 5; i++) {
      const web = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), mats.steel);
      web.position.set(i * 1.8, 0.22, 0);
      web.rotation.z = (i % 2 ? 1 : -1) * 0.5;
      g.add(web);
    }
    // four par cans on the truss, aimed down at the floor and sweeping
    const cans = [];
    for (let i = 0; i < 4; i++) {
      const can = new THREE.Group();
      can.position.set(-6.75 + i * 4.5, -0.05, 0);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8), mats.steel);
      body.position.y = 0.25;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), new THREE.MeshBasicMaterial({
        color: LASER_COLOURS[i], transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      }));
      lens.material.userData.gtbRealized = true;
      lens.rotation.x = -Math.PI / 2;
      lens.position.y = 0.0;
      can.add(body, lens);
      // the cone of light it throws: additive, so it costs nothing to look at
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.1, 10, 1, true), beamMat(LASER_COLOURS[i], 0.1));
      beam.position.y = -1.55;
      can.add(beam);
      g.add(can);
      cans.push({ can, phase: i * 0.9, speed: 0.5 + i * 0.13, colour: LASER_COLOURS[i] });
    }
    // the laser: a projector box on the back wall and a fan of beams off it
    const rig = new THREE.Group();
    rig.position.set(0, -0.4, -4.6);
    g.add(rig);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.34), mats.steel);
    box.position.set(0, 0.2, 0.1);
    rig.add(box);
    const fan = new THREE.Group();
    fan.position.set(0, 0.2, 0.2);
    rig.add(fan);
    for (let i = 0; i < 7; i++) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.16, 5.4, 6, 1, true), beamMat(LASER_COLOURS[i % LASER_COLOURS.length], 0.16));
      // the cone's apex is its +y end, so hanging it half a length below the
      // arm puts the apex ON the lens and the fan out across the room below
      beam.position.set(0, -2.7, 0);
      beam.rotation.z = (i - 3) * 0.19;          // and fanned out across the room
      const arm = new THREE.Group();
      arm.rotation.y = (i - 3) * 0.11;
      arm.add(beam);
      fan.add(arm);
    }
    rec.lights = { cans, fan, t: 0, colour: 0 };
  }

  function beamMat(color, opacity) {
    const m = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    m.userData.gtbRealized = true;
    return m;
  }

  function updateLights(rec, dt) {
    const L = rec.lights;
    if (!L) return;
    L.t += Math.max(0, dt);
    for (const c of L.cans) {
      // the sweep, on each can's own rate so they cross rather than move as one
      c.can.rotation.z = Math.sin(L.t * c.speed + c.phase) * 0.75;
      c.can.rotation.x = 0.35 + Math.cos(L.t * c.speed * 0.6 + c.phase) * 0.3;
    }
    // the laser fan turns steadily, and changes colour on a bar of its own
    L.fan.rotation.y = L.t * 0.55;
    const step = Math.floor(L.t / 4) % LASER_COLOURS.length;
    if (step !== L.colour) {
      L.colour = step;
      for (const c of L.cans) c.can.children[1].material.color.setHex(c.colour);
    }
  }

  // ---- the floor ------------------------------------------------------------
  // Fourteen of the paying public, on the floor where a paying public stands:
  // a rail at the front of the stage, a knot of them out on the dance floor,
  // and the ones who never leave the bar. They are only built when the branch is
  // registered and only ticked while you are in the room, so an empty one costs
  // nothing (see update).
  function buildPatrons(root, rec, def) {
    const rng = (() => { let a = (rec.x * 7919 + rec.z * 104729) | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    // the bar down the west wall — a club with no bar is a stage with a floor
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 7.0), mats.bar);
    bar.position.set(-8.5, 0.55, 0.6);
    root.add(bar);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 7.2), mats.trim);
    top.position.set(-8.5, 1.12, 0.6);
    root.add(top);
    const backShelf = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 7.0), mats.trim);
    backShelf.position.set(-9.2, 1.6, 0.6);
    root.add(backShelf);
    for (let i = 0; i < 9; i++) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 6), bottleMat(LASER_COLOURS[i % LASER_COLOURS.length]));
      bottle.position.set(-9.2, 1.78, -2.4 + i * 0.72);
      root.add(bottle);
    }
    // the spots, in the order the room fills them
    const rail = [];
    for (let i = 0; i < 6; i++) rail.push({ x: -6.4 + i * 2.55, z: -1.15, face: Math.PI, still: false });
    const floor = [
      { x: -1.6, z: 1.9, face: 0.4 }, { x: 0.9, z: 2.4, face: -0.5 }, { x: 2.7, z: 1.5, face: 0.8 },
      { x: -3.2, z: 2.6, face: 0.2 }, { x: 3.9, z: 2.8, face: -0.7 },
      { x: 0.2, z: 0.4, face: 0.1 },
    ];
    const barSpots = [
      { x: -7.3, z: -1.8, face: -Math.PI / 2, still: true },
      { x: -7.3, z: 0.6, face: -Math.PI / 2, still: true },
      { x: -7.3, z: 3.0, face: -Math.PI / 2, still: true },
    ];
    const patrons = [];
    for (const spot of [...rail, ...floor, ...barSpots]) {
      if (patrons.length >= PATRONS) break;
      const kind = rng();
      const actor = makePatron(rng, 1.74 + rng() * 0.12, kind);
      actor.userData.performer = false;
      actor.traverse((o) => { if (o.isMesh) o.userData.noBatch = true; });
      actor.position.set(spot.x, 0, spot.z);
      actor.baseY = 0;
      actor._yaw = spot.face; actor.rotation.y = spot.face;
      if (actor._last) actor._last.copy(actor.position);
      actor.play(spot.still ? "idle" : "dance", { force: true, loop: true });
      actor.update(0.001);
      root.add(actor);
      // `a` is the handle main.js's crowd hit branch calls into (`p.a.play`,
      // `p.a.userData`) — the nightlife.js record shape — and `hp`/`dead` are
      // the fields it mutates. A patron is a person like any other on the
      // strip: without them the crowd branch read `undefined -= dmg` and
      // nobody in a franchise branch could be hurt. 4 hp, same as nightlife.
      patrons.push({ actor, a: actor, spot, home: spot, beat: rng() * 6.28, t: 0, hp: 4, dead: false });
    }
    rec.patrons = patrons;
  }

  function updatePatrons(rec, dt) {
    for (const p of rec.patrons) {
      // a patron the player has shot keeps animating (main.js plays "death")
      // but is not re-choreographed: the clip timer below would otherwise
      // stand them back up mid-death.
      if (p.dead) { p.actor.update(dt); continue; }
      p.t += Math.max(0, dt);
      p.beat += dt;
      p.actor.update(dt);
      if (p.spot.still) {
        // at the bar: weight shifts, and a look around every few seconds
        if (p.actor.torso) p.actor.torso.rotation.y = Math.sin(p.beat * 0.4) * 0.5;
        p.actor._yaw = p.spot.face + Math.sin(p.beat * 0.23) * 0.25;
        p.actor.rotation.y = p.actor._yaw;
        continue;
      }
      // out on the floor: a slow drift inside a small disc, and a change of
      // clip on the bar so the knot is never eight people doing one thing
      const w = p.beat * 0.55 + p.home.x;
      p.actor.position.x = p.home.x + Math.sin(w) * 0.32;
      p.actor.position.z = p.home.z + Math.cos(w * 0.7) * 0.28;
      if (p.actor._last) p.actor._last.copy(p.actor.position);
      if (p.t > 4 + p.home.x) {
        p.t = 0;
        p.actor.play(["dance", "twerk", "grind", "sync"][((p.home.z * 3) | 0) & 3], { force: true, loop: true });
      }
    }
  }

  function register({ kind = "billy", x, z, rot = 0, exteriorRoof = null, exteriorFront = [], exteriorBack = [], host: hostSpec = null }) {
    const def = BRANCHES[kind];
    if (!def || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const root = new THREE.Group(); root.position.set(x, 0, z); root.rotation.y = rot;
    root.name = `${def.name} Branch Interior`;
    // HOST MODE (crownstrip.js): the club's room ALREADY EXISTS. The Crown Strip
    // builds its four flagship venues itself (interiors.js fixtures) and never
    // used this module's shell, so its BILLY JEANS / STOOGELETS / HAPPY HOGS had
    // dancers but none of the games. Registering a second 19.2 x 10 club on top
    // of one would build a room inside a room, so when a `host` spec is given
    // only what a flagship lacks is built: the back-room annex (hung off the
    // VENUE's rear wall) and the host. The shell, stage and light rig are the
    // venue's own, and the chase cast would only double the dancers it already
    // has (its crowd.js cast), so neither is added.
    const inHost = !!hostSpec;
    // The corridor mouth sits at the branch's own rear wall by default, or at
    // the venue's rear wall in host mode.
    const mouthZ = inHost ? (hostSpec.backZ ?? -5.15) : -5.15;
    if (!inHost) {
      // Local +z faces the branch's exterior doorway; the room is entered from it.
      box(root, 19.2, 0.08, 10.0, mats.floor, 0, 0.02, -0.05);
      box(root, 20, 0.25, 0.35, mats.wall, 0, 0.13, -5.15);
      for (const sx of [-9.65, 9.65]) box(root, 0.35, 3.4, 10.0, mats.wall, sx, 1.7, -0.05);
      // The rear wall, in two leaves either side of the corridor mouth. It is
      // WIDE across the room (19.2 like the floor) and thin in z — a side wall's
      // dimensions (0.35, 3.4, 10.0) at x = 0 put a full-height wall down the
      // CENTRE of the floor instead: through the stage, and directly in front of
      // the back-room corridor, which is why the annex read as unreachable.
      for (const sx of [-1, 1]) box(root, 6.85, 3.4, 0.35, mats.wall, sx * 6.175, 1.7, -5.15);
      box(root, 20, 0.24, 0.35, mats.trim, 0, 3.15, -0.05);
      box(root, 18, 0.46, 3.1, mats.stage, 0, 0.45, -3.1);
      for (const px of [-6.5, 6.5]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.4, 8), mats.trim);
        pole.position.set(px, 1.65, -3); pole.castShadow = true; root.add(pole);
      }
      const screenMat = new THREE.MeshStandardMaterial({ color: def.palette, emissive: def.palette, emissiveIntensity: 0.14, roughness: 0.55, name: "club dance screen" });
      screenMat.userData.gtbRealized = true;
      box(root, 3.5, 2.4, 0.14, screenMat, -6.8, 1.25, -3.6);
      // The rear wall leaves the corridor mouth open (same trick as the front:
      // the shell's collision is at the townkit back line, the annex re-adds
      // its own blockers around the actual opening).
      // Radius 1.5 at z -5.15 reaches z -3.65, but the stage deck only starts at
      // z -4.65 (box(root, 18, 0.46, 3.1, mats.stage, 0, 0.45, -3.1)). So a
      // full-height blocker was standing ON the stage for its back metre: the deck
      // is knee-high and meant to be climbed, and this is the invisible wall that
      // stopped you getting up to the performer with the white glove.
      //
      // Pulled back to r 0.45 so the ring ends at z -4.7, a 5 cm gap clear of the
      // deck. The rear wall's own mesh (box(root, 20, 0.24, 0.35, mats.trim, ...))
      // is unaffected -- it is at z -5.15 too, and 0.45 still covers its 0.175 m
      // half-depth.
      for (const lx of [-8.6, -6.4, -4.2, -2.6, 2.6, 4.2, 6.4, 8.6]) {
        const p = worldAt(x, z, lx, -5.15, rot); addBlocker(p.x, p.z, 0.45);
      }
    }

    // ---- the cast ---------------------------------------------------------
    // The record exists before the cast does, because the cast is handed the
    // club's shared clock (see `rec.beat` below) on the way in.
    const rec = {
      kind, def, x, z, rot, root, exteriorRoof, exteriorFront, exteriorBack,
      performers: [], host: null, plays: 0, encores: 0, encoreTimer: 0,
      encoreWasActive: false, coffeeStays: 0, coffeeCd: 0, nights: 0, nightCd: 0,
      // the house clock. One object, advanced once per frame in update() and
      // shared by every performer and every patron on this stage.
      beat: { t: 0 },
      routineIndex: 0, routineElapsed: 0, routine: STAGE_ROUTINES[kind],
    };
    if (inHost) {
      rec.hostGeom = {
        halfW: hostSpec.halfW, frontZ: hostSpec.frontZ, backZ: hostSpec.backZ, mouthZ,
        privateDance: hostSpec.privateDance || { lx: 0, lz: hostSpec.backZ + 4 },
        visibility: hostSpec.visibility ?? (hostSpec.halfW + Math.abs(hostSpec.backZ) + 24),
      };
      rec.patrons = [];        // the venue has its own crowd; updatePatrons still ticks
    }
    const performers = rec.performers;
    const n = inHost ? 0 : kind === "hogs" ? 3 : 2;
    const routine = STAGE_ROUTINES[kind];
    const costumes = kind === "hogs" ? HOG_COSTUMES : kind === "stoogelets" ? STOOGE_COSTUMES : BILLY_COSTUMES;
    const names = STAGE_NAMES[kind];
    for (let i = 0; i < n; i++) {
      const costume = costumes[(clubs.length + i) % costumes.length];
      const wardrobe = {
        glam: true, skirt: costume.skirt, denim: costume.skirt,
        shoe: "heels", heelColor: costume.heelColor,
        thighBoots: i === 2, bootColor: costume.heelColor,
        // the two themed casts: Billy Jeans's men dance shirtless (glitter
        // pants and heels stay), Happy Hogs's women dance IN THE MASK — pig
        // snout, ears, pig tails. Stoogelets: the house's own stage costume.
        // The women wear the stripper rig (bikini band over the bust, gstring,
        // bare legs) rather than a top and a skirt: the same geometry the
        // sheet's own pole dancers wear, and the one the room is paying for.
        shirtless: kind === "billy",
        hogMask: kind === "hogs",
        stripper: kind !== "billy",
        // the house is a strip club, so the women are billed on more than the
        // sheet's own read — a great deal more (ignored on the billys, who are
        // not women). STAGE_BUST is per franchise.
        bust: STAGE_BUST[kind],
      };
      const actor = kind === "hogs"
        ? makeAdultHog({ variant: "dancer", sex: "f", seed: 8830 + clubs.length * 11 + i, height: 1.80, age: 25 + i, top: costume.top, ...wardrobe })
        : makeAdultDancer({ sex: kind === "billy" ? "m" : "f", seed: 9180 + clubs.length * 13 + i, height: kind === "billy" ? 1.82 : 1.80, top: costume.top, ...wardrobe });
      actor.userData.adult = true;
      // The rig owns the age now (characters.js reads `opts.age` and enforces a
      // floor on it), so the cast is stamped as adult by construction rather
      // than by this module re-asserting it afterwards. `Math.max(25, ... || 25)`
      // used to be here and was worth nothing: nothing read `opts.age`, so the
      // left side was always 25 no matter what was cast.
      assertAdult(actor);
      actor.userData.fictional = true;
      actor.userData.franchise = def.name;
      actor.userData.performer = true;
      actor.userData.stageName = names[i % names.length];
      actor.userData.costume = kind === "hogs" ? "hog mask and pig tails — heels, sequins, nothing else"
        : kind === "billy" ? "shirtless — glitter pants and heels"
        : "bikini top and gstring — heels, and nothing else";
      actor.userData.outfit = { top: costume.top, skirt: costume.skirt, shoes: "heels", clothed: kind === "billy", bikini: kind !== "billy", hogMask: kind === "hogs", shirtless: kind === "billy" };
      actor.position.set((kind === "hogs" ? -4.1 : 4.1) + (i - (n - 1) / 2) * 1.45, 0.72, -2.5 + (i % 2) * 0.35);
      actor._yaw = 0; actor.rotation.y = 0;
      // Every performer on this stage reads the SAME clock, which is what makes
      // the `sync` numbers read as choreography: `play()` resets an actor's own
      // `time` on every routine change, so without a clock everybody else would
      // still be on the previous count.
      actor.beatRef = rec.beat;
      actor.play(routine[0], { force: true, loop: true }); actor.update(0.001);
      actor.traverse((o) => { if (o.isMesh) o.userData.noBatch = true; });
      root.add(actor);
      // same contract as a patron (see buildPatrons): `a`/`hp`/`dead` so
      // main.js's `hittable()` loop and its crowd hit branch can hit the
      // house cast the way it hits the nightlife clubs' dancers.
      performers.push({ actor, a: actor, routine, routineIndex: 0, routineElapsed: 0, routineChanges: 0, hp: 4, dead: false });
      rec.routine = routine;
    }
    // one dancer waits in the back room: the night's host. Same cast, off stage.
    const host = kind === "hogs"
      ? makeAdultHog({ variant: "dancer", sex: "f", seed: 8830 + clubs.length * 11 + 9, height: 1.80, age: 26, top: costumes[0].top, glam: true, hogMask: true, stripper: true, skirt: costumes[0].skirt, shoe: "heels", heelColor: costumes[0].heelColor, bust: STAGE_BUST.hogs })
      : makeAdultDancer({ sex: kind === "billy" ? "m" : "f", seed: 9180 + clubs.length * 13 + 9, height: kind === "billy" ? 1.82 : 1.80, top: costumes[0].top, glam: kind !== "billy", shirtless: kind === "billy", hogMask: kind === "hogs", stripper: kind !== "billy", skirt: costumes[0].skirt, shoe: "heels", heelColor: costumes[0].heelColor, bust: STAGE_BUST[kind] });
    host.userData.adult = true; assertAdult(host);
    host.userData.fictional = true; host.userData.franchise = def.name; host.userData.performer = true;
    host.userData.stageName = names[0];
    host.userData.costume = costumes[0] ? "the host's own take on the house costume" : "house costume";
    host.userData.outfit = { top: costumes[0].top, skirt: costumes[0].skirt, shoes: "heels", clothed: kind === "billy", bikini: kind !== "billy", hogMask: kind === "hogs", shirtless: kind === "billy" };
    host.traverse((o) => { if (o.isMesh) o.userData.noBatch = true; });
    host.beatRef = rec.beat;
    root.add(host);
    rec.host = host;
    buildBackRooms(root, rec, mouthZ);
    // The host waits IN the back room. Nothing ever set her position, so she
    // stood at the root origin — the middle of the club floor — while the night
    // scene believed she was on the bed. Place her on the room's spot.
    host.position.set(rec.backSpotLocal.lx, 0, rec.backSpotLocal.lz);
    if (!inHost) {
      buildLightRig(root, rec);
      buildPatrons(root, rec, def);
    }
    root.visible = false;
    root.traverse((o) => { if (o.isMesh) o.userData.noBatch = true; });
    scene.add(root);
    clubs.push(rec);
    return rec;
  }

  function update(dt, playerPos) {
    prompt = null;
    for (const c of clubs) {
      const dx = playerPos ? playerPos.x - c.x : Infinity;
      const dz = playerPos ? playerPos.z - c.z : Infinity;
      const lx = Math.cos(c.rot) * dx - Math.sin(c.rot) * dz;
      const lz = Math.sin(c.rot) * dx + Math.cos(c.rot) * dz;
      // host mode: the "room" is the Crown Strip venue and the annex hangs off
      // its rear wall, so both extents come from the host spec (rec.hostGeom)
      const hg = c.hostGeom || null;
      const inside = hg
        ? Math.abs(lx) < hg.halfW - 0.4 && lz > hg.backZ && lz < hg.frontZ
        : Math.abs(lx) < 9.2 && lz > -5.0 && lz < 4.8;
      // the annex sits past the stage: local z from -6 to -16.5, |x| < 2.9
      const inBack = hg
        ? Math.abs(lx) < 2.9 && lz <= hg.mouthZ - 0.85 && lz > hg.mouthZ - 11.35
        : Math.abs(lx) < 2.9 && lz <= -6 && lz > -16.5;
      c.root.visible = inside || inBack || Math.hypot(dx, dz) < (hg ? hg.visibility : 15);
      if (c.exteriorRoof) c.exteriorRoof.visible = !(inside || inBack);
      for (const part of c.exteriorFront || []) part.visible = !(inside || inBack);
      // The service-door leaves in the BACK wall are culled on a DIFFERENT
      // condition from the front: they hide while the player is on the club
      // floor, but must stay drawn while they are in the corridor, because the
      // corridor runs out through that doorway — hiding the leaves there would
      // put a hole in the world exactly where the player is standing. Outside,
      // of course, they are the building's back.
      for (const part of c.exteriorBack || []) part.visible = !inside;
      if (c.root.visible) {
        const wasEncore = c.encoreWasActive;
        c.encoreTimer = Math.max(0, c.encoreTimer - Math.max(0, dt));
        c.coffeeCd = Math.max(0, (c.coffeeCd || 0) - Math.max(0, dt));
        c.nightCd = Math.max(0, (c.nightCd || 0) - Math.max(0, dt));
        c.encoreWasActive = c.encoreTimer > 0;
        if (wasEncore && !c.encoreWasActive) {
          for (const p of c.performers) p.actor.play(c.routine[c.routineIndex], { force: true, loop: true });
        }
        // The house clock, and the routine that runs off it. The whole cast
        // changes on the same beat — a routine change is a cue, and a cue the
        // rest of the stage has not heard is just a woman dancing to herself.
        c.beat.t += Math.max(0, dt);
        if (!c.encoreWasActive) {
          c.routineElapsed += Math.max(0, dt);
          if (c.routineElapsed >= ROUTINE_SECONDS) {
            const steps = Math.floor(c.routineElapsed / ROUTINE_SECONDS);
            c.routineElapsed %= ROUTINE_SECONDS;
            c.routineIndex = (c.routineIndex + steps) % c.routine.length;
            const next = c.routine[c.routineIndex];
            for (const p of c.performers) {
              if (p.dead) continue;      // shot: not re-cast mid-death
              p.routineIndex = c.routineIndex;
              p.routineChanges += steps;
              // Each performer owns her own number: a strip tease on a three-woman
              // stage is three separate teases with three separate wardrobes, and
              // they are started and ended per performer rather than per room.
              endStageAct(p);
              if (STAGE_ACTS.includes(next)) {
                p.act = beginStageAct(p.actor, next) || null;
                if (p.act) { p.actClock = 0; continue; }   // it refused (gate) — fall through
              }
              p.actor.play(next, { force: true, loop: true });
            }
          }
          // ...and a number is bounded: when it is over the costume goes back on
          // and she carries on dancing. A dancer left bare for the rest of the
          // night is a bug, not a feature.
          for (const p of c.performers) {
            if (!p.act) continue;
            p.actClock = (p.actClock || 0) + Math.max(0, dt);
            if (p.actClock >= p.act.seconds) { p.act.end(); p.act = null; p.actClock = 0; }
          }
        }
        for (const p of c.performers) p.actor.update(dt);
        updateLights(c, dt);
        updatePatrons(c, dt);
        // A staged scene runs on this club's own clock, not the world's: the
        // night overlay pauses the sim, and a scene that froze the moment you
        // chose it would be the most lifeless thing in the building.
        if (c.staged) c.staged.update(Math.max(dt, 1 / 120));
        if (c.host) {
          // the host waits on the bed, mid-dance pose, and follows the player
          // with her yaw so she "watches" them come in
          const hp = c.backSpot;
          const hx = playerPos ? playerPos.x - hp.x : 0;
          const hz = playerPos ? playerPos.z - hp.z : 0;
          c.host._yaw = Math.atan2(hx, hz) - c.rot;
          c.host.update(dt);
        }
      }
      if ((inside || inBack) && runtimeState?.running && !runtimeState.veh && !busy) {
        // NOTE the key. These prompts are `interact`, which input.js:43 binds to
        // KeyE; main.js:1717 routes the E press here. They briefly advertised F
        // during the era when `interact` was KeyF — but "I pressed what the
        // screen said and the minigame never started" (human report,
        // 2026-10-02) is exactly the failure this label must never cause again.
        // F is driveOrTorch now (cars and the torch) and must NOT open a club.
        if (inBack && Math.hypot(lx - c.backStandLocal.lx, lz - c.backStandLocal.lz) < 3.2) {
          const who = c.host?.userData.stageName || "a performer";
          const price = Math.round(NIGHT_PRICE * (c.coffeeStays > 0 ? NIGHT_REGULAR_DISCOUNT : 1));
          prompt = { club: c, type: "night", text: contentGate?.enabled?.()
            ? `E · Go back with ${who} · $${price}` + (c.nightCd > 0 ? ` (she needs ${Math.ceil(c.nightCd)}s)` : "")
            : "Back rooms disabled · adult opt-in required" };
        } else if (!hg && inside && Math.hypot(lx, lz - 0.55) < 2.2) {
          prompt = { club: c, type: "encore", text: `E · Request a stage encore · tip $${ENCORE_TIP}` };
        } else if (inside && (hg
          ? Math.hypot(lx - hg.privateDance.lx, lz - hg.privateDance.lz) < 2.4
          : Math.hypot(lx + 6.8, lz + 2.8) < 1.75)) {
          prompt = { club: c, type: "privateDance", text: contentGate?.enabled?.() ? `E · Private dance with an adult performer · $${c.def.price}` : "Private dance disabled · adult opt-in required" };
        } else if (inside && (hg
          ? Math.abs(lx) < 2.4 && lz < hg.backZ + 2.6 && lz > hg.backZ - 0.6
          : Math.abs(lx) < 2.4 && lz < -2.4 && lz > -5.0)) {
          // The corridor mouth, on the club floor. The back rooms sit behind the
          // stage with no sign, no light and no marker, so a player who did not
          // already know the building would walk the whole floor, find three
          // other prompts, and conclude the feature was not there at all
          // (human report, 2026-10-02). The player authorised changing how this
          // is found, so the night is now offered from the doorway as well as
          // from the back of the corridor: same handler, same price, same gate
          // (`interact` -> `type === "night"`), so the two cannot drift apart.
          const who = c.host?.userData.stageName || "a performer";
          const price = Math.round(NIGHT_PRICE * (c.coffeeStays > 0 ? NIGHT_REGULAR_DISCOUNT : 1));
          prompt = { club: c, type: "night", text: contentGate?.enabled?.()
            ? `E · Head through the back corridor to ${who} · $${price}` + (c.nightCd > 0 ? ` (she needs ${Math.ceil(c.nightCd)}s)` : "")
            : "Back rooms disabled · adult opt-in required" };
        }
      }
    }
    if (promptEl) { promptEl.hidden = !prompt; promptEl.textContent = prompt ? prompt.text : ""; }
  }

  function priceOf(c) { return Math.round(NIGHT_PRICE * (c.coffeeStays > 0 ? NIGHT_REGULAR_DISCOUNT : 1)); }

  /**
   * The back-room night, as ONE function, so the E prompt in the corridor and
   * the general dialogue system (dialogue.js, which offers a performer
   * "ask if they can make some time for you") are the same door rather than
   * two that can drift apart — different price, different gate or different
   * cooldown depending on which one the player happened to find.
   *
   * Takes the club, or a flattened person carrying the club's host.
   * @returns {boolean} true if it took the request.
   */
  function talkToHost(cOrPerson) {
    const c = cOrPerson?.host && cOrPerson.actors ? cOrPerson : clubs.find((k) => k.host && (!cOrPerson?.host || k.host === cOrPerson.host));
    if (!c) { flashObjective("She is not taking requests right now."); return false; }
    if (!contentGate?.enabled?.()) { flashObjective("The back rooms need the 18+ answer at the front of the game."); return true; }
    if ((c.nightCd || 0) > 0) { flashObjective(`${c.host?.userData.stageName || "She"} is with someone. Give her ${Math.ceil(c.nightCd)}s.`); return true; }
    const who = c.host?.userData.stageName || "a performer";
    const price = priceOf(c);
    busy = true;
    const opened = contentGate.openNightScene({
      venue: c.def.name,
      price,
      performerName: who,
      // ...and the room itself: a finale that names a position stages it, on the
      // bed, with the two rigs the scene module knows how to place
      stage: (pose) => stageScene(c, pose),
      onStageEnd: () => unstageScene(c),
      perks: {
        text: c.coffeeStays > 0 ? `Regulars' rate · +50 HP · the bed remembers you` : `+50 HP · you'll be a regular after this`,
        pay: () => {
          if (!runtimeState || runtimeState.cash < price) { flashObjective(`You need $${price}. She's not a charity.`); return false; }
          runtimeState.cash -= price;
          c.nights++;
          c.nightCd = NIGHT_COOLDOWN;
          syncHUD();
          return true;
        },
        grant: (heat) => {
          let healed = 0;
          if (runtimeState) {
            const before = runtimeState.hp || 100;
            runtimeState.hp = Math.min(100, before + 50);
            healed = runtimeState.hp - before;
            c.coffeeStays = Math.max(c.coffeeStays, 1);   // a night makes you a regular too
            syncHUD();
          }
          return { healed, heat };
        },
      },
      onFinish: (result) => {
        busy = false;
        unstageScene(c);
        if (result && result.night) {
          const h = result.perk && result.perk.healed;
          flashObjective(`${who}: "same time tomorrow, sugar."` + (h ? ` +${h} HP.` : ""));
        }
      },
    });
    if (!opened) busy = false;
    return true;
  }

  /**
   * Put the player and the house's host into a position, in the back room, and
   * take them out of it again.
   *
   * This is the entry point the six couple clips were built without until now.
   * `createAct` refuses to start a pair it cannot cast — a minor, or the 18+ gate
   * unanswered — and that refusal is the answer here too: it throws, we catch it,
   * the night carries on as text, and the player never finds out there was a
   * version they were not shown.
   *
   * @param {object} c     the club record
   * @param {string} pose  a key of act.js's SCENES
   * @returns {object|null} the act, or null if it could not be staged
   */
  function stageScene(c, pose) {
    if (c.staged) { c.staged.stop(); c.staged = null; }
    if (!pose) return null;
    const P = getPlayer();
    if (!P || !c.host || !worldScene) return null;
    try {
      // on the bed, which buildBackRooms recorded as rec.bedLocal
      const at = worldAt(c.x, c.z, c.bedLocal ? c.bedLocal.lx : 0, c.bedLocal ? c.bedLocal.lz : -14.2, c.rot);
      at.y = 0;
      const act = createAct({ lead: c.host, partner: P, scene: worldScene, name: pose, at, yaw: c.rot });
      act.start();
      c.staged = act;
      // the player is being driven, so the world must not also drive it — the
      // same arrangement the lap-dance cinematic uses
      if (runtimeState) runtimeState.cinematic = true;
      return act;
    } catch (e) {
      c.staged = null;
      flashObjective("She stays dressed tonight.");
      return null;
    }
  }

  function unstageScene(c) {
    if (!c.staged) return;
    c.staged.stop();
    c.staged = null;
    if (runtimeState) runtimeState.cinematic = false;
  }

  function interact() {
    if (busy) return true;
    if (!prompt) return false;
    const c = prompt.club;
    if (prompt.type === "encore") {
      if (!contentGate?.acknowledged?.()) { flashObjective("Confirm you are 18+ before entering the club."); return true; }
      if (!runtimeState || runtimeState.cash < ENCORE_TIP) { flashObjective(`You need $${ENCORE_TIP} to tip for an encore.`); return true; }
      runtimeState.cash -= ENCORE_TIP;
      c.encores++;
      c.encoreTimer = ENCORE_SECONDS;
      c.encoreWasActive = true;
      for (const p of c.performers) p.actor.play("twerk", { force: true, loop: true });
      c.routineIndex = c.routine.indexOf("twerk");
      c.routineElapsed = 0;
      syncHUD();
      flashObjective(`${c.def.name}: encore requested. The performers take the stage!`);
      return true;
    }
    if (prompt.type === "night") {
      return talkToHost(c);
    }
    if (!contentGate?.enabled?.()) { flashObjective("Private dances need the 18+ answer at the front of the game."); return true; }
    busy = true;
    const dancePrice = () => (c.coffeeStays > 0 ? Math.round(c.def.price * COFFEE_REGULAR_DISCOUNT) : c.def.price);
    const opened = contentGate.openRhythmGame({
      venue: c.def.name,
      onBegin: () => {
        const price = dancePrice();
        if (!runtimeState || runtimeState.cash < price) { flashObjective(`You need $${price}; no charge was made.`); return false; }
        runtimeState.cash -= price; c.plays++; syncHUD();
        flashObjective(c.coffeeStays > 0 ? `Regulars' tab — private dance $${price} · match the arrows · Esc exits.` : "Private dance started · match the arrows · Esc exits at any time.");
        return true;
      },
      onFinish: (result) => {
        busy = false;
        if (result) flashObjective(`${c.def.name}: ${result.rating} (${result.score}/${result.total}).`);
        // hot-coffee-style beat (2026-09-28, expanded 2026-09-29): every
        // finished dance can end in the invitation — the performer's line
        // scales with the score (adultContent.js coffeeTier). Staying heals
        // and makes you a regular; a per-club cooldown stops repeat farming.
        if (result && (c.coffeeCd || 0) <= 0) {
          const regular = c.coffeeStays > 0;
          const perkBits = [];
          if (runtimeState && (runtimeState.hp || 100) < 100) perkBits.push(`+${COFFEE_HEAL} HP if you stay`);
          if (!regular) perkBits.push(`Stay once and dances drop to $${Math.round(c.def.price * COFFEE_REGULAR_DISCOUNT)}`);
          contentGate.openCoffeeScene({
            venue: c.def.name,
            result,
            perks: {
              text: perkBits.join(" · "),
              grant: () => {
                c.coffeeStays++;
                c.coffeeCd = COFFEE_COOLDOWN;
                let healed = 0;
                if (runtimeState) {
                  const before = runtimeState.hp || 100;
                  runtimeState.hp = Math.min(100, before + COFFEE_HEAL);
                  healed = runtimeState.hp - before;
                  syncHUD();
                }
                return { healed, regular: true };
              },
            },
            onFinish: (coffee) => {
              // coffee is { coffee: true, tier, perk: { healed, regular } } when
              // the player stayed, or null when they headed out
              if (coffee && coffee.perk && coffee.perk.healed > 0) flashObjective(`You stayed for coffee. +${coffee.perk.healed} HP — and you're a regular here now.`);
              else if (coffee) flashObjective("You stayed for coffee. You're a regular here now.");
            },
          });
        }
      },
    });
    if (!opened) busy = false;
    return true;
  }

  return {
    register,
    setRuntime(next = {}) {
      if (next.state) runtimeState = next.state;
      if (next.adultContent) contentGate = next.adultContent;
      if (next.flashObjective) flashObjective = next.flashObjective;
      if (next.syncHUD) syncHUD = next.syncHUD;
    },
    update, interact,
    /**
     * Every person in a franchise branch worth shooting at, in world space,
     * within `maxDist` of the player — the floor patrons and the house cast,
     * and nothing in a room that is not ticking.
     *
     * Identical shape and contract to nightlife.js's `hittable()` (and so to
     * crownstrip.js's), which is the whole point: main.js's fire() collects
     * both into one `venuePeople` list and hands the winner to one crowd hit
     * branch, and that branch mutates `rec.hp`/`rec.dead` and calls
     * `rec.a.play`. franchiseClubs' records carry those fields (see
     * buildPatrons/register) so a branch patron is killed exactly the way a
     * nightlife dancer is.
     *
     * The culling flag here is `c.root.visible`, which `update()` sets from
     * the same inside/back/near test that gates the room's tick — the analogue
     * of nightlife.js's `c.actorGroup.visible` and crownstrip's
     * `r.crowdIn.group.visible`. Nobody in a branch you have walked away from
     * is targetable.
     *
     * Positions come from `getWorldPosition`: `root` is added to the scene at
     * `(c.x, 0, c.z)` with `rotation.y = c.rot`, so the actors' local spots are
     * already placed in world space by the scene graph — no manual
     * `worldAt()` conversion, unlike crownstrip's detached crowd groups.
     *
     * The back-room host is deliberately absent: she is the actor the paid
     * night scene is built around, and nothing downstream of her death (the
     * corridor prompt, dialogue.js) is death-aware.
     */
    hittable(playerPos, maxDist = 45) {
      const out = [];
      const d2 = maxDist * maxDist;
      for (const c of clubs) {
        if (!c.root.visible) continue;
        for (const rec of [...c.performers, ...(c.patrons || [])]) {
          if (!rec.a || rec.dead) continue;
          const p = rec.a.getWorldPosition(_hittableV);
          const dx = p.x - playerPos.x, dz = p.z - playerPos.z;
          if (dx * dx + dz * dz > d2) continue;
          out.push({ x: p.x, y: p.y, z: p.z, rec });
        }
      }
      return out;
    },
    /** The back-room night, shared by the corridor prompt and dialogue.js. */
    talkToHost,
    get clubs() { return clubs; },
    get debug() {
      return clubs.map((c) => {
      const cast = [...c.performers, { actor: c.host }];
      return ({ name: c.def.name, x: c.x, z: c.z, entranceOpen: true, dancers: c.performers.length,
        allAdults: cast.every((p) => p.actor && p.actor.userData.age >= 18 && p.actor.userData.adult),
        allFictional: cast.every((p) => p.actor && p.actor.userData.fictional),
        // the stage costume contract: the women are in the house bikini, the
        // billys are shirtless. Nobody in a franchise branch is fully dressed.
        allStageCostume: cast.every((p) => p.actor && (p.actor.userData.outfit?.bikini === true || p.actor.userData.outfit?.shirtless === true)),
        // what the room is actually made of
        patrons: (c.patrons || []).length,
        dancing: (c.patrons || []).filter((p) => !p.spot.still).length,
        atBar: (c.patrons || []).filter((p) => p.spot.still).length,
        lights: c.lights ? { cans: c.lights.cans.length, fanBeams: c.lights.fan.children.length } : null,
        sharedClock: c.performers.every((p) => p.actor.beatRef === c.beat),
        synchronized: c.performers.every((p) => p.actor.anim === c.performers[0].actor.anim),
        routinesUsed: [...new Set(c.routine)],
        costumes: cast.filter((p) => p.actor).map((p) => p.actor.userData.outfit),
        stageNames: cast.filter((p) => p.actor).map((p) => p.actor.userData.stageName),
        routines: c.performers.map((p) => p.actor.anim),
        routineChanges: c.performers.reduce((sum, p) => sum + p.routineChanges, 0),
        encoreActive: c.encoreWasActive,
        encores: c.encores,
        hogDancers: c.kind === "hogs" ? cast.filter((p) => p.actor && p.actor.userData.hog).length : 0,
        backRoomReady: !!(c.backStand && c.backSpot && c.host),
        plays: c.plays,
        coffeeStays: c.coffeeStays,
        coffeeCd: c.coffeeCd,
        nights: c.nights,
        nightCd: c.nightCd,
      });
      });
    },
  };
}
