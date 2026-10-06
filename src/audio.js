import * as THREE from 'three';

let listener = null;
const audioCache = new Map();

export function initAudio(camera) {
  if (!listener) {
    listener = new THREE.AudioListener();
    camera.add(listener);
  }
}

// Browsers start an AudioContext suspended until a user gesture; every sound
// built before that stays silent even after initAudio(). Call once on the
// first click (confirmCharacter).
export function resumeAudio() {
  if (listener && listener.context && listener.context.state === 'suspended') {
    listener.context.resume().catch(() => { /* stays muted until the next gesture */ });
  }
}

export function loadSound(file) {
  if (audioCache.has(file)) return Promise.resolve(audioCache.get(file));
  return new Promise(resolve => {
    new THREE.AudioLoader().load(file, buffer => {
      audioCache.set(file, buffer);
      resolve(buffer);
    }, undefined, () => resolve(null));
  });
}

/**
 * QA seam (tools/qa/spatial_voice_test.mjs): seed the decode cache directly.
 * The real loader needs a network fetch and a live AudioContext, so a headless
 * test cannot produce a buffer any other way — and without a buffer it cannot
 * reach the panner, which is the whole thing under test.
 */
export function seedSound(file, buffer) { audioCache.set(file, buffer); }

// ---------------------------------------------------------- spatial voices
// NPC/dialogue audio used to be a bare HTMLAudioElement at a fixed 0.95, so
// every line in the city was the same loudness, centred in the player's head,
// and audible through a warehouse. It now goes through the camera's
// AudioListener: a PannerNode places the mouth in the world, distance rolls
// the level off, air and walls roll the top end off, and the voice tracks a
// walking speaker.
const VOICE_REF_DISTANCE = 2.6;    // m: full level this close, mouth-to-mouth
const VOICE_MAX_DISTANCE = 55;     // m: past this a voice is a murmur
const VOICE_ROLLOFF = 1.7;          // >1 = falls off faster than plain inverse
const VOICE_BUS_GAIN = 0.9;
const VOICE_MAX_SIMULTANEOUS = 3;   // a street of barks must not stack into a wall
let voiceOcclusionTest = null;      // (x0, z0, x1, z1) -> true when a wall is in the way
let playerPosRef = null;            // { x, z } — set by updateSpatialVoices each frame
const liveVoices = [];              // { src, panner, lp, follow, last } — position-tracked

/** Called once from main.js with the world's line-of-sight test. */
export function setVoiceOcclusion(fn) { voiceOcclusionTest = fn; }

// The panner wants a mouth, not a pair of feet.
function placeVoice(v, now) {
  const p = v.follow?.position || v.last;
  if (!p) return;
  v.last = { x: p.x, y: p.y, z: p.z };
  const y = (p.y ?? 0) + 1.5;
  if (v.panner.positionX) {         // AudioParam-style panners
    v.panner.positionX.setTargetAtTime(p.x, now, 0.02);
    v.panner.positionY.setTargetAtTime(y, now, 0.02);
    v.panner.positionZ.setTargetAtTime(p.z, now, 0.02);
  } else {
    v.panner.setPosition(p.x, y, p.z);
  }
}

// Speech is mostly 300 Hz - 4 kHz, so rolling the top end off is what actually
// makes a voice read as "across the street" rather than merely quiet. The curve
// is air absorption, exponential in distance: full open air in the same breath,
// ~7 kHz at 25 m (across a four-lane road), ~4 kHz at 40 m, ~2.4 kHz at the
// 55 m edge where the panner is already a murmur. A wall is a separate, much
// harder clamp — if distance alone could reach 420 Hz, this filter could not
// tell "behind a warehouse" from "far away", which is the distinction the
// player is hearing for.
const VOICE_AIR_CUTOFF_HZ = 18000, VOICE_AIR_FALLOFF_M = 25;
const VOICE_WALL_CUTOFF_HZ = 420, VOICE_FLOOR_HZ = 320;
function applyVoiceFilter(v, px, pz, now) {
  if (!v.lp || !v.last) return;
  const d = Math.hypot(v.last.x - px, v.last.z - pz);
  let hz = VOICE_AIR_CUTOFF_HZ * Math.exp(-d / VOICE_AIR_FALLOFF_M);
  if (voiceOcclusionTest && voiceOcclusionTest(px, pz, v.last.x, v.last.z)) {
    hz = Math.min(hz, VOICE_WALL_CUTOFF_HZ);
  }
  v.lp.frequency.setTargetAtTime(Math.max(VOICE_FLOOR_HZ, hz), now + 0.05, 0.08);
}

/**
 * Play one recorded voice clip in the world.
 *   file    path under assets/audio/
 *   at      { x, y, z } fixed mouth position, or
 *   follow  an Object3D-ish whose .position tracks a walking speaker
 *   volume  0..1 pre-attenuation
 * Returns a Promise for the clip's real duration (0 when it never played, so
 * callers can fall back to a subtitle-only hold).
 */
export function playSpatialVoice(file, { at = null, follow = null, volume = 1 } = {}) {
  const ctx = audioCtx();
  if (!ctx || (!at && !follow)) return Promise.resolve(0);
  return loadSound(file).then((buf) => {
    if (!buf || !audioCtx()) return 0;
    const c = ctx;
    // A street of simultaneous barbs is noise, not ambience: keep the loudest
    // few and drop the rest (this one goes silent, the subtitle still shows).
    const live = liveVoices.filter((v) => v.end > c.currentTime);
    if (live.length >= VOICE_MAX_SIMULTANEOUS) return 0;
    liveVoices.length = 0;
    live.forEach((v) => liveVoices.push(v));

    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    // Small per-line level + pitch variance: two NPCs saying "what?" in the same
    // frame should not sound like one duplicated sample.
    gain.gain.value = volume * VOICE_BUS_GAIN * (0.88 + Math.random() * 0.24);
    src.playbackRate.value = 0.97 + Math.random() * 0.06;

    // Distance/occlusion lowpass. Speech is mostly 300 Hz - 4 kHz, so rolling
    // the top end off is what actually makes a voice read as "across the
    // street" rather than just quiet.
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.4;

    const panner = c.createPanner();
    panner.panningModel = "HRTF";          // real direction, not a stereo pan
    panner.distanceModel = "inverse";
    panner.refDistance = VOICE_REF_DISTANCE;
    panner.maxDistance = VOICE_MAX_DISTANCE;
    panner.rolloffFactor = VOICE_ROLLOFF;

    src.connect(gain).connect(lp).connect(panner).connect(listener.getInput());

    const entry = { src, panner, lp, follow: follow || null, last: at ? { ...at } : null,
                    end: c.currentTime + buf.duration / src.playbackRate.value };
    liveVoices.push(entry);

    // Place it now, not on the next frame — a panner sitting at the origin for
    // one frame is an audible blip in the player's ear.
    placeVoice(entry, c.currentTime);
    if (playerPosRef) applyVoiceFilter(entry, playerPosRef.x, playerPosRef.z, c.currentTime);

    return new Promise((resolve) => {
      src.onended = () => {
        const i = liveVoices.indexOf(entry);
        if (i >= 0) liveVoices.splice(i, 1);
        try { src.disconnect(); gain.disconnect(); lp.disconnect(); panner.disconnect(); } catch (e) {}
        resolve(buf.duration);
      };
      src.start();
      // Belt and braces: never leave a caller awaiting a silent clip. Cleared
      // on the real end so a stopped voice does not hold a timer open.
      const t = setTimeout(() => resolve(buf.duration), (buf.duration + 0.5) * 1000);
      src.addEventListener?.("ended", () => clearTimeout(t), { once: true });
    });
  }).catch(() => 0);
}

/** Cut a live voice short (skip, scene change). Safe to call at any time. */
export function stopSpatialVoices() {
  for (const v of liveVoices) { try { v.src.onended = null; v.src.stop(); } catch (e) {} }
  liveVoices.length = 0;
}

/**
 * Called once a frame from main.js. Re-places any voice that is following a
 * walking speaker, and re-evaluates its air/wall filtering. Costs nothing when
 * nothing is talking — the common case.
 */
export function updateSpatialVoices(playerX, playerZ) {
  if (!liveVoices.length) return;
  playerPosRef = { x: playerX, z: playerZ };
  const now = listener?.context?.currentTime ?? 0;
  for (let i = liveVoices.length - 1; i >= 0; i--) {
    const v = liveVoices[i];
    if (v.end <= now) { liveVoices.splice(i, 1); continue; }
    placeVoice(v, now);
    applyVoiceFilter(v, playerX, playerZ, now);
  }
}

export function createPositionalAudio(buffer, { volume = 1, loop = false, refDistance = 10, maxDistance = 100 } = {}) {
  if (!listener || !buffer) return null;
  const sound = new THREE.PositionalAudio(listener);
  sound.setBuffer(buffer);
  sound.setRefDistance(refDistance);
  sound.setMaxDistance(maxDistance);
  sound.setVolume(volume);
  sound.setLoop(loop);
  // Important for distance attenuation
  sound.setDistanceModel('exponential');
  return sound;
}

/**
 * Car audio, created for every registered vehicle — including the whole
 * traffic pool — but it builds real WebAudio nodes only once a car is first
 * driven (`update` called with `active`). registerVehicle runs before any
 * user gesture and before initAudio(), so eager creation would leak a
 * THREE.AudioListener into every car's JSON (context has cyclic refs) and
 * play engine loops for cars nobody is near.
 *
 * Returns { update(speedKmh, isSkidding, active), destroy } — safe to call
 * before initAudio / any gesture: it just does nothing until the world is real.
 */
export function createCarAudio(carObj) {
  const loopIdx = Math.floor(Math.random() * 5);

  const sounds = {
    engine: null,
    squeal: null,
    started: false,   // real nodes built
    active: false,    // currently the player's car

    update: (speedKmh, isSkidding, active = true) => {
      if (!listener) return;                 // initAudio() hasn't run yet
      if (!active) {                         // traffic / parked: nothing plays
        if (sounds.started) sounds.destroy();
        return;
      }
      if (!sounds.started) {
        sounds.started = true;
        const audioGroup = new THREE.Group();
        carObj.add(audioGroup);
        const myGroup = audioGroup;
        sounds.group = audioGroup;
        Promise.all([
          loadSound(`assets/audio/car/car_engine_loop${loopIdx}.wav`),
          loadSound('assets/audio/car/tires_squal_loop.wav'),
        ]).then(([engineBuf, squealBuf]) => {
          // the car may have exploded / been swapped while loading
          if (!sounds.started || sounds.group !== myGroup) return;
          sounds.engine = createPositionalAudio(engineBuf, { loop: true, volume: 0.1 });
          sounds.squeal = createPositionalAudio(squealBuf, { loop: true, volume: 0.5 });
          if (sounds.engine) { sounds.group.add(sounds.engine); sounds.engine.play(); }
          if (sounds.squeal) sounds.group.add(sounds.squeal);
        });
      }

      // The engine may still be loading on the first few frames
      if (!sounds.engine || !sounds.squeal) return;

      // Pitch engine up based on speed
      const speedNorm = Math.min(speedKmh / 100, 1);
      sounds.engine.setPlaybackRate(1.0 + (speedNorm * 1.5));
      sounds.engine.setVolume(0.1 + (speedNorm * 0.4));

      // Handle tire squeal
      if (isSkidding) {
        if (!sounds.squeal.isPlaying) sounds.squeal.play();
      } else {
        if (sounds.squeal.isPlaying) sounds.squeal.pause();
      }
    },

    destroy: () => {
      if (sounds.engine && sounds.engine.isPlaying) sounds.engine.stop();
      if (sounds.squeal && sounds.squeal.isPlaying) sounds.squeal.stop();
      if (sounds.group && sounds.group.parent) sounds.group.parent.remove(sounds.group);
      sounds.started = false;
      sounds.engine = null;
      sounds.squeal = null;
      sounds.group = null;
    },
  };

  return sounds;
}

// ---------------------------------------------------------------------------
// Zombie-mode ambience (TASK-081). Occasional distant groans — not a moan bed:
// real silence between them, more often and louder the more zombies are close.
//
// Recorded SFX (2026-09-27, human-supplied): groan0/groan1/moan0/utter0 are
// picked at random for the ambience. scream0 is deliberately never loaded or
// played; the sharp wail was too loud and frequent. There is no synth fallback:
// a missing ambience file is simply silent and never breaks the game.
//
// `trim` normalises the ambient voices to each other (measured with
// tools/qa/zombie_audio_audit.mjs, 2026-09-27). Ambient groans are levelled to
// well under the ~0.32 pistol crack. The Screamer archetype's sharp wail is
// intentionally disabled: repeated loud shrieks were overwhelming normal play.
//
// Distance scaling (human report, 2026-09-28: "too loud and not scaled when
// distant"): a voice plays at full level only for a zombie right on top of
// you; the closest zombie's distance fades it toward a whisper floor, and its
// bearing sets the stereo side instead of a coin-flip pan.
//
// Everything here is safe to call at any time: before initAudio(), before a
// user gesture, with the context suspended, or after stop. It never throws.
//
//   start: on entering zombie mode / at nightfall   startZombieAmbience(...)
//   stop:  at dawn / leaving the mode               stopZombieAmbience()
// ---------------------------------------------------------------------------
const ZOMBIE_SFX = [
  { path: "assets/audio/zombie/groan0.mp3", trim: 0.62 },
  { path: "assets/audio/zombie/groan1.mp3", trim: 0.2 },
  { path: "assets/audio/zombie/moan0.mp3", trim: 1.4 },
  { path: "assets/audio/zombie/utter0.mp3", trim: 0.3 },
];
const GROAN_MIN_GAP = 4, GROAN_MAX_GAP = 22;     // seconds, at 1 zombie ... a crowd
const HEARD_FULL_COUNT = 12;                     // this many nearby = the busiest it gets
const GROAN_HEAR_RANGE = 60;                     // m: past the closest zombie this far away, a groan is at its whisper floor (matches main.js's nearby count radius)
let zAmb = null;                                 // { getPlayerPos, getCount, getNearest, timer }

function audioCtx() {
  return listener && listener.context && listener.context.state === 'running' ? listener.context : null;
}

// one recorded voice, panned, optionally pitch-shifted — the only zombie
// voices since the synth was retired; a file that fails to load stays silent
function playRecorded(ctx, file, volume, pan, rate) {
  return loadSound(file).then((buf) => {
    if (!buf || !audioCtx()) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    if (rate) src.playbackRate.value = rate;
    g.gain.value = volume;
    src.connect(g);
    let tail = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      g.connect(p); tail = p;
    }
    tail.connect(listener.getInput());
    src.start();
  }).catch(() => { /* a missing file must never take the game down */ });
}

function playGroan(volume, pan = Math.random() * 1.6 - 0.8) {
  const ctx = audioCtx();
  if (!ctx || !ZOMBIE_SFX.length) return;
  // the clamp matters: Math.random() can return exactly 1, and an unclamped
  // index throws (silently swallowed by scheduleGroan) — the groan would vanish
  const voice = ZOMBIE_SFX[Math.min(ZOMBIE_SFX.length - 1, (Math.random() * ZOMBIE_SFX.length) | 0)];
  playRecorded(ctx, voice.path, volume * voice.trim, pan);
}

// Stereo side of a world point relative to the camera: -1 hard left, +1 hard
// right. Softened to 80% so a voice never sits fully on one ear. Returns null
// when the camera cannot be read (then the caller keeps its random pan).
const panV = new THREE.Vector3(), panF = new THREE.Vector3();
function panFor(x, z) {
  try {
    const cam = listener.parent || listener;
    cam.getWorldPosition(panV);
    cam.getWorldDirection(panF);
    const dx = x - panV.x, dz = z - panV.z;
    const len = Math.hypot(dx, dz) || 1;
    // right = forward x up = (-fz, 0, fx); pan = dot(dir, right)
    return Math.max(-1, Math.min(1, ((dz * panF.x - dx * panF.z) / len) * 0.8));
  } catch { return null; }
}

function scheduleGroan() {
  if (!zAmb) return;
  let gap = 3;                       // nobody near: just check back
  try {
    const n = zAmb.getCount();
    if (n > 0) {
      const crowd = Math.min(1, n / HEARD_FULL_COUNT);
      let vol = 0.3 + 0.55 * crowd;
      let pan = Math.random() * 1.6 - 0.8;
      // Distance scaling: the closest zombie sets level and stereo side. Full
      // volume only when it is on top of you; past GROAN_HEAR_RANGE the voice
      // sits at a 20% floor (a horde two streets away is felt, not heard).
      const near = zAmb.getNearest ? zAmb.getNearest() : null;
      if (near) {
        const prox = Math.max(0, Math.min(1, 1 - near.dist / GROAN_HEAR_RANGE));
        vol *= 0.2 + 0.8 * prox * prox;
        const p = panFor(near.x, near.z);
        if (p !== null) pan = p;
      }
      playGroan(vol, pan);
      gap = GROAN_MAX_GAP - (GROAN_MAX_GAP - GROAN_MIN_GAP) * crowd;
      gap *= 0.6 + Math.random() * 0.8;    // vary the cadence, but keep the documented quiet gap bound
      gap = Math.max(GROAN_MIN_GAP, Math.min(GROAN_MAX_GAP, gap));
    }
  } catch (e) { /* keep the loop alive */ }
  zAmb.timer = setTimeout(scheduleGroan, gap * 1000);
}

/**
 * Begin the ambience. `getPlayerPos()` -> {x, z}; `getNearbyZombieCount()` ->
 * how many zombies are close enough to be heard; optional
 * `getNearestZombie()` -> {x, z, dist} for distance-scaled loudness and stereo
 * (omitted: a random pan and the crowd level, as before). Idempotent.
 */
export function startZombieAmbience(getPlayerPos, getNearbyZombieCount, getNearestZombie = null) {
  if (zAmb) return;
  zAmb = { getPlayerPos, getCount: getNearbyZombieCount, getNearest: getNearestZombie, timer: null };
  zAmb.timer = setTimeout(scheduleGroan, 2000);
}

export function stopZombieAmbience() {
  if (!zAmb) return;
  clearTimeout(zAmb.timer);
  zAmb = null;
}
