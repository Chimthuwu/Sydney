// ---------------------------------------------------------------------------
// act.js — placing two performers for a private scene.
//
// The couple clips in characters.js are half-poses. This is the other half: it
// owns where the two bodies are, how they are oriented to each other, and how
// they get there and leave again. Splitting it this way is why a position is
// one name played by two actors rather than two clips that drift apart — the
// geometry of the pair is here, in one place, and the bodies only ever describe
// what they do on top of it.
//
// Every scene here is between two FICTIONAL ADULTS who have both agreed: the
// caller is responsible for that, and characters.js enforces the second half of
// it (an actor past the age floor, with the 18+ gate answered) before any of
// these clips will play. `start()` refuses a pair that cannot be cast.
//
// It is deliberately presentation-only. Nothing here touches the player, the
// world, or anyone's save state: a scene is two rigs, a pose and a clock, and
// it is over when it is over.
// ---------------------------------------------------------------------------

import * as THREE from "three";

/**
 * How the pair is arranged, per position. All of it is in the scene's own
 * coordinate frame: the pair is centred on the origin, facing +z, and the
 * caller puts the whole group where it wants in the room.
 *
 *   gap     metres between the two origins along the pair's own axis
 *   yaw     the partner's facing relative to the lead's
 *   lift    how high the group's floor is (a bed, a floor, a chaise)
 *   lie     true when both roots are laid on their backs/sides rather than stood
 *   tilt    roll applied to the laid-down roots, so a body is not perfectly flat
 *
 * `lie` is the important one: lying a rig down is a root transform, not a pose,
 * and doing it here means the twelve couple poses never have to know where the
 * floor is.
 */
export const SCENES = Object.freeze({
  missionary:  { gap: 0.62, yaw: 0,           lift: 0.42, lie: true,  tilt: 0 },
  doggystyle:  { gap: 0.78, yaw: 0,           lift: 0.36, lie: false, tilt: 0 },
  oral:        { gap: 0.66, yaw: Math.PI,     lift: 0.40, lie: true,  tilt: 0 },
  roughOral:   { gap: 0.58, yaw: Math.PI,     lift: 0.40, lie: true,  tilt: 0 },
  sixtyNine:   { gap: 0.70, yaw: 0,           lift: 0.34, lie: true,  tilt: 0.08 },
  assToMouth:  { gap: 0.64, yaw: Math.PI / 2, lift: 0.40, lie: true,  tilt: 0 },
});

/** The stage business a dancer can work into a set, and what it leaves on. */
export const STAGE_ACT = Object.freeze({
  stripTease:  { seconds: 9.2, leaves: "all"  },   // the whole costume
  flash:       { seconds: 4.1, leaves: null },
  spreadTease: { seconds: 4.6, leaves: null },
  stageRub:    { seconds: 6.8, leaves: null },
});

const LAY_DOWN = -Math.PI / 2;      // a root rolled onto its back, facing +z

/**
 * One scene: two rigs, a position, and a clock.
 *
 * @param {object} o
 * @param {THREE.Object3D} o.lead     the actor whose `coupleRole` is "lead"
 * @param {THREE.Object3D} o.partner  ...and "partner". Both must pass
 *   characters.js's adult-clip gate, or `start()` throws.
 * @param {THREE.Scene} o.scene
 * @param {string} o.name             a key of SCENES
 * @param {THREE.Vector3} [o.at]      where the pair goes, in world space
 * @param {number} [o.yaw]            the pair's facing
 */
export function createAct({ lead, partner, scene, name, at = null, yaw = 0 }) {
  const def = SCENES[name];
  if (!def) throw new Error(`act: no scene called "${name}"`);
  const group = new THREE.Group();
  group.name = `act:${name}`;
  // placed at construction rather than at start(), so the caller can position a
  // scene before deciding whether to run it
  if (at) group.position.copy(at);
  group.rotation.y = yaw;

  // What each rig was doing, and where it stood, before. Restoring that is the
  // difference between a scene ending and a scene leaving the district changed.
  const saved = [lead, partner].map((a) => ({
    a,
    parent: a.parent,
    pos: a.position.clone(),
    rot: a.rotation.clone(),
    scale: a.scale.clone(),
    visible: a.visible,
    baseY: a.baseY,
    anim: a.anim,
    role: a.coupleRole,
    yaw: a._yaw,
    lie: a.lie,
    lieYaw: a.lieYaw,
  }));

  const pair = [
    { a: lead, role: "lead", z: -def.gap / 2 },
    { a: partner, role: "partner", z: def.gap / 2 },
  ];

  let t = 0, running = false;

  function place() {
    for (const { a, role, z } of pair) {
      a.coupleRole = role;
      if (def.lie) {
        // laid on her back, or rolled for the ones that need it, with the body's
        // own length running along the pair's axis. `lie` tells `_poseClip` to
        // leave the root alone — otherwise it stands her back up on the next
        // frame, which is what it did the first time round.
        a.lie = true;
        a.lieYaw = 0;
        a.rotation.set(LAY_DOWN, 0, role === "partner" ? def.tilt : -def.tilt);
        a.position.set(0, def.lift, z);
      } else {
        a.lie = false;
        const yaw = role === "partner" ? def.yaw : 0;
        a._yaw = yaw;
        a.rotation.set(0, yaw, 0);
        a.position.set(0, 0, z);
      }
      a.baseY = a.position.y;
      a.visible = true;
      if (a._last) a._last.copy(a.position);
    }
  }

  const api = {
    group,
    get running() { return running; },
    get elapsed() { return t; },

    /**
     * Put the pair in the room and put them in the position.
     * Throws rather than silently degrading if either actor cannot be cast —
     * a scene that quietly failed to start is the one failure mode here that
     * would be invisible.
     */
    start() {
      for (const { a } of pair) {
        if (a.adultClipRefused !== null && a.adultClipRefused !== undefined) {
          throw new Error(`act: ${a.name || "an actor"} was refused an adult clip and cannot be cast`);
        }
        if (a.allowsAdultClip && !a.allowsAdultClip()) {
          throw new Error("act: refuses to cast — an actor is not past the age floor, or the 18+ gate is unanswered");
        }
        if (a.setGarment) a.setGarment("all", false);
      }
      group.add(lead, partner);
      place();
      // both rigs get the same clock, so the two halves of a position breathe
      // together instead of drifting apart inside a few seconds
      const clock = { t: 0 };
      api.clock = clock;
      for (const { a, role } of pair) {
        a.beatRef = clock;
        a.coupleRole = role;
        a.play(name, { force: true, loop: true });
        a.update(0.001);
      }
      t = 0;
      running = true;
      return api;
    },

    /** One frame. The clock belongs to the scene, not to either rig. */
    update(dt) {
      if (!running) return;
      t += Math.max(0, dt);
      api.clock.t = t;
      for (const { a } of pair) a.update(Math.max(0, dt));
    },

    /** Put everything back exactly as it was found. */
    stop() {
      if (!running) return api;
      running = false;
      for (const s of saved) {
        if (s.a.restoreWardrobe) s.a.restoreWardrobe();
        s.a.beatRef = null;
        s.a.coupleRole = s.role;
        s.a.lie = s.lie;
        s.a.lieYaw = s.lieYaw;
        s.a._yaw = s.yaw;
        if (s.parent) s.parent.add(s.a);
        s.a.position.copy(s.pos);
        s.a.rotation.copy(s.rot);
        s.a.scale.copy(s.scale);
        s.a.visible = s.visible;
        s.a.baseY = s.baseY;
        if (s.anim) s.a.play(s.anim, { force: true, loop: true });
      }
      group.clear();
      if (at) scene && group.removeFromParent && group.parent && group.parent.remove(group);
      return api;
    },
  };

  if (scene) scene.add(group);
  return api;
}

/**
 * Pick a stage act that suits a performer, and leave her dressed in it.
 *
 * The branch stage calls this when a routine turns over to the explicit half of
 * the house. The wardrobe is put back afterwards by whoever ends the number —
 * a venue that leaves a dancer bare for the rest of the night is a bug, not a
 * feature, so `endStageAct` exists and is the other half of this.
 */
export function beginStageAct(actor, name) {
  const def = STAGE_ACT[name];
  if (!def) return null;
  if (!actor.allowsAdultClip || !actor.allowsAdultClip()) return null;
  const before = actor.anim;
  actor.play(name, { force: true, loop: true });
  return {
    name,
    seconds: def.seconds,
    leaves: def.leaves,
    previous: before,
    end() {
      if (actor.restoreWardrobe) actor.restoreWardrobe();
      actor.play(before || "dance", { force: true, loop: true });
    },
  };
}
