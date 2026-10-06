// ---------------------------------------------------------------------------
// spatial_voice_test.mjs — is an NPC's line actually coming from the NPC?
//
//   node --experimental-detect-module tools/qa/spatial_voice_test.mjs
//
// A human report (2026-10-03): "the NPC dialogs never sound like they're coming
// from the direction of the NPC, they're all very loud and at the same volume
// always ... they don't even sound like they're in the same space as the
// player."
//
// The cause was not a tuning mistake — it was that voice lines never went
// through the audio graph at all. cinema.js built a bare `new Audio()` element
// at a fixed 0.95, which has no panner, no listener, and no distance model, so
// every line in the city was identical and inside the player's skull. No amount
// of volume tweaking fixes that; the signal has to be routed.
//
// What this asserts, against the real audio.js:
//   A. the graph a voice builds: an HRTF panner on the camera's listener, an
//      inverse distance model, and a ref/max distance pair — a clip routed
//      anywhere else cannot sound directional
//   B. a voice given a position is placed AT that position, at mouth height,
//      before its first sample (a panner at the origin for one frame is a blip)
//   C. a voice given a `follow` target tracks a walking speaker
//   D. the lowpass closes with distance and closes hard behind a wall
//   E. a clip with no position is refused rather than played at the origin
//   F. a stopped voice is stopped, and a voice never outlives its clip
// ---------------------------------------------------------------------------

import * as THREE from "three";

let failures = 0;
function assert(cond, msg, detail = "") {
  if (cond) { console.log(`  ok   ${msg}${detail ? `  — ${detail}` : ""}`); return; }
  failures++;
  console.error(` FAIL  ${msg}${detail ? `  — ${detail}` : ""}`);
}
function section(name) { console.log(`\n--- ${name} ---`); }

// ---------------------------------------------------------------------------
// A minimal but RECORDING Web Audio stub. It must behave like the real thing
// where the code under test branches on it, or the test proves nothing: the
// graph is captured, the panners are captured, and the filters are readable.
// ---------------------------------------------------------------------------
const panners = [];
const filters = [];
const sources = [];
const log = [];

const audioParam = (v = 0) => ({
  value: v,
  _targets: [],
  setTargetAtTime(t, now, tc) { this._targets.push(t); this.value = t; this._now = now; this._tc = tc; log.push(`param->${t}`); },
  linearRampToValueAtTime(t) { this.value = t; },
  setValueAtTime(t) { this.value = t; },
  exponentialRampToValueAtTime(t) { this.value = t; },
});
const audioNode = (extra = {}) => ({ connect() { return this; }, disconnect() { log.push("disconnect"); }, gain: audioParam(1), ...extra });

const context = {
  state: "running",
  currentTime: 0,
  destination: {},
  sampleRate: 48000,
  listener: {
    _pos: null,
    setPosition(x, y, z) { this._pos = [x, y, z]; },
    getPosition() { return this._pos; },
    setOrientation() {},
  },
  createGain: () => audioNode(),
  createBiquadFilter: () => {
    const f = audioNode({ type: "", Q: audioParam(1), frequency: audioParam(20000) });
    filters.push(f);
    return f;
  },
  createStereoPanner: () => audioNode({ pan: audioParam(0) }),
  createPanner: () => {
    // HRTF panners expose AudioParams for position; the legacy shape exposes
    // setPosition(). Both are supported by audio.js and the stub must model
    // both, because picking one would hide half the code.
    const p = audioNode({
      panningModel: "", distanceModel: "", refDistance: 1, maxDistance: 10000,
      rolloffFactor: 1, coneInnerAngle: 360, coneOuterAngle: 360, coneOuterGain: 0,
      positionX: audioParam(0), positionY: audioParam(0), positionZ: audioParam(0),
      _set: [],
      setPosition(x, y, z) { this._set.push([x, y, z]); this.positionX.value = x; this.positionY.value = y; this.positionZ.value = z; },
      setOrientation() {},
    });
    panners.push(p);
    return p;
  },
  createBufferSource: () => {
    const s = audioNode({ buffer: null, loop: false, playbackRate: audioParam(1), onended: null, started: false, stopped: false });
    sources.push(s);
    s.start = function () { this.started = true; log.push("src.start"); };
    s.stop = function () { this.stopped = true; log.push("src.stop"); };
    return s;
  },
  createBuffer: (ch, len) => ({ length: len, sampleRate: 48000, getChannelData: () => new Float32Array(len) }),
  createOscillator: () => audioNode({ frequency: audioParam(440), type: "" }),
  resume() { this.state = "running"; return Promise.resolve(); },
  decodeAudioData: (b) => Promise.resolve({ duration: 2.0 }),
  close() { return Promise.resolve(); },
};

globalThis.AudioContext = function () { return context; };
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, createElement: () => ({ getContext: () => context, style: {} }) };
if (!globalThis.navigator) globalThis.navigator = { userAgent: "node" };

const audio = await import("../../src/audio.js");

// The loader needs a network fetch and a live AudioContext, so the buffers are
// seeded through audio.js's own documented QA seam.
const CLIP = { duration: 2.0 };
for (const f of ["test_line", "walk", "far", "settles"]) audio.seedSound(`assets/audio/voice/${f}.mp3`, CLIP);

// ---------------------------------------------------------------------------
section("A. graph — a voice is routed through the camera's listener");
const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 420);
camera.position.set(0, 1.6, 0);
audio.initAudio(camera);

await audio.playSpatialVoice("assets/audio/voice/test_line.mp3", { at: { x: 10, y: 0, z: 10 }, volume: 1 });
// playSpatialVoice resolves on the clip's end or a 0.5 s guard timer; the guard
// is what returns here, which is fine — every assertion below is about the
// graph, not the playout.
assert(panners.length === 1, "one panner per voice", `panners=${panners.length}`);
assert(sources.length === 1 && sources[0].started, "the clip is started");
const p = panners[0];
assert(p.panningModel === "HRTF", "panning model is HRTF", p.panningModel);
assert(p.distanceModel === "inverse", "distance model attenuates", p.distanceModel);
assert(p.refDistance > 0 && p.refDistance < p.maxDistance, "ref distance is inside max distance",
  `ref=${p.refDistance} max=${p.maxDistance}`);
assert(p.rolloffFactor > 1, "rolloff is steeper than plain inverse (a voice must not carry down the highway)", `rolloff=${p.rolloffFactor}`);

// ---------------------------------------------------------------------------
section("B. placement — the panner lands on the speaker's mouth, immediately");
assert(Math.abs(p.positionX.value - 10) < 0.001 && Math.abs(p.positionZ.value - 10) < 0.001,
  "x/z are the speaker's", `x=${p.positionX.value} z=${p.positionZ.value}`);
assert(p.positionY.value > 1.0 && p.positionY.value < 2.2, "y is mouth height, not the feet", `y=${p.positionY.value}`);
// Between sections the street goes quiet. Without this the concurrency cap
// would refuse later voices and section E would pass for entirely the wrong
// reason — a refused-for-crowding voice is not a refused-for-nowhere voice.
audio.stopSpatialVoices();

// ---------------------------------------------------------------------------
section("C. tracking — a walking speaker drags the voice with it");
const walker = { position: new THREE.Vector3(10, 0, 10) };
await audio.playSpatialVoice("assets/audio/voice/walk.mp3", { follow: walker, volume: 1 });
const tracked = panners[1];
assert(!!tracked, "a follow target produces its own panner");
walker.position.set(-14, 0, 6);
audio.updateSpatialVoices(0, 0);
assert(Math.abs(tracked.positionX.value + 14) < 0.01 && Math.abs(tracked.positionZ.value - 6) < 0.01,
  "the panner moved with the speaker", `x=${tracked.positionX.value} z=${tracked.positionZ.value}`);
audio.stopSpatialVoices();

// ---------------------------------------------------------------------------
section("D. distance and walls — a voice gets quieter and duller with range");
const before = filters.length;
await audio.playSpatialVoice("assets/audio/voice/far.mp3", { at: { x: 40, y: 0, z: 0 }, volume: 1 });
const nearish = filters[before];
audio.updateSpatialVoices(0, 0);
const openHz = nearish.frequency.value;
audio.setVoiceOcclusion(() => true);          // a wall now stands in the way
audio.updateSpatialVoices(0, 0);
const walledHz = nearish.frequency.value;
audio.setVoiceOcclusion(() => false);
audio.updateSpatialVoices(0, 0);
const openAgain = nearish.frequency.value;
assert(walledHz < openHz, "a wall closes the lowpass", `open=${openHz}Hz walled=${walledHz}Hz`);
assert(openAgain > walledHz, "removing the wall opens it again", `back to ${openAgain}Hz`);
assert(openAgain > 1500 && openAgain < 20000, "open air at 40 m is dulled but still speech, not a wall",
  `${Math.round(openAgain)}Hz at 40 m`);
assert(walledHz <= 420.001, "a wall caps the cutoff at a muffled 420 Hz", `${walledHz}Hz`);
audio.stopSpatialVoices();

// ---------------------------------------------------------------------------
section("E. a line with nowhere to be is refused, not dumped at the origin");
const beforeE = panners.length;
const dur = await audio.playSpatialVoice("assets/audio/voice/orphan.mp3", { volume: 1 });
assert(panners.length === beforeE, "no panner was built", `panners=${panners.length}`);
assert(dur === 0, "and it reports 0 so the caller falls back to a subtitle-only hold", `dur=${dur}`);

// ---------------------------------------------------------------------------
section("F. lifecycle — stop is immediate, and a voice cannot outlive its clip");
audio.stopSpatialVoices();
assert(sources.every((s) => s.stopped), "every live source was stopped", `${sources.filter((s) => s.stopped).length}/${sources.length}`);

// The promise contract matters to cinema.js's say(): it holds a subtitle for
// the clip's duration. A promise that never settles hangs the cutscene.
const d2 = await Promise.race([
  audio.playSpatialVoice("assets/audio/voice/settles.mp3", { at: { x: 1, y: 0, z: 1 }, volume: 1 }),
  new Promise((r) => setTimeout(() => r("HUNG"), 4000)),
]);
assert(typeof d2 === "number" && d2 > 0, "playSpatialVoice always settles with a real duration", `got ${d2}`);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
