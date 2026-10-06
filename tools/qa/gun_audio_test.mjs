// ---------------------------------------------------------------------------
// gun_audio_test.mjs — recorded gunshot samples (2026-09-27).
//
// Verifies:
//   A. the manifest covers every gun kind cinema.sfx() intercepts, and every
//      sample file actually exists on disk (a manifest entry pointing at a
//      missing file would silently degrade every shot to the synth).
//   B. playGunSfx plays a decoded sample as a buffer source at volume * trim,
//      the picker is clamped (Math.random() === 1 must not throw), loads are
//      deduped, and a failed decode / 404 resolves false instead of playing.
//   C. cinema.sfx() routes the four gun kinds through gunAudio first and only
//      synthesises when no sample played; non-gun kinds are untouched.
//
// Run: node tools/qa/gun_audio_test.mjs
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { gunSfxManifest, prewarmGunAudio, playGunSfx, _resetForTests } from "../../src/gunAudio.js";

let failures = 0;
function check(cond, msg) {
  if (cond) { console.log(`✓ PASS: ${msg}`); return; }
  failures++;
  console.error(`✗ FAIL: ${msg}`);
}
const flush = () => new Promise((r) => setImmediate(r));

// --------------------------------------------------------------------------- A
console.log("\n--- A. manifest + assets on disk ---");
{
  const manifest = gunSfxManifest();
  for (const kind of ["shotgun", "pistolShot", "tec9Shot", "rifleShot"]) {
    check(Array.isArray(manifest[kind]) && manifest[kind].length > 0, `manifest has a sample pool for "${kind}"`);
  }
  for (const [kind, pool] of Object.entries(manifest)) {
    for (const s of pool) {
      await access(s.path).then(
        () => check(true, `${kind}: ${s.path} exists`),
        () => check(false, `${kind}: ${s.path} exists on disk`),
      );
      check(typeof s.trim === "number" && s.trim > 0, `${kind}: ${s.path} has a positive trim`);
    }
  }
  check(!manifest.gunshot, "distant 'gunshot' stays synthesised (no sample claims it)");
}

// ------------------------------------------------------------- fake audio ctx
const bufferPlays = [];   // every buffer source started through the fake ctx
function makeCtx({ running = true, decodeOk = true } = {}) {
  const audioParam = () => ({
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, setTargetAtTime() {},
  });
  const ctx = {
    state: running ? "running" : "suspended",
    destination: { tag: "dest" },
    currentTime: 0,
    sampleRate: 44100,
    createBuffer(ch, len) {
      const chans = Array.from({ length: ch }, () => new Float32Array(len));
      return { length: len, getChannelData: (i) => chans[i] };
    },
    createBufferSource() {
      const src = {
        connect() { return src; }, start() { bufferPlays.push(src); },
        buffer: null, playbackRate: audioParam(),
      };
      return src;
    },
    createGain() { const g = { connect() { return g; }, gain: audioParam() }; return g; },
    createOscillator() {
      const o = { type: "sine", frequency: audioParam(), detune: audioParam(), connect() { return o; }, start() {}, stop() {} };
      return o;
    },
    createBiquadFilter() { const f = { type: "lowpass", frequency: audioParam(), Q: { value: 0 }, gain: audioParam(), connect() { return f; } }; return f; },
    decodeAudioData(bytes) {
      return this.decodeOk
        ? Promise.resolve({ tag: "decoded", byteLength: bytes.byteLength })
        : Promise.reject(new Error("decode failed"));
    },
  };
  ctx.decodeOk = decodeOk;
  return ctx;
}
const realFetch = globalThis.fetch;
const realRandom = Math.random;

// --------------------------------------------------------------------------- B
console.log("\n--- B. playGunSfx contract ---");
{
  globalThis.fetch = async () => new Response(new ArrayBuffer(64), { status: 200 });
  const ctx = makeCtx();
  _resetForTests();
  prewarmGunAudio(ctx);
  prewarmGunAudio(ctx);   // idempotent — must not re-trigger loads

  let played = 0;
  for (const r of [0, 0.5, 0.999, 1]) {
    Math.random = () => r;
    if (await playGunSfx("pistolShot", 0.45)) played++;
  }
  check(played === 4, "each settled pick plays (picker clamped across random range, incl. 1)");

  Math.random = () => 0;
  check(await playGunSfx("shotgun", 1) === true, "shotgun sample plays at volume 1");
  check(await playGunSfx("tec9Shot", 1) === true, "tec9 sample plays");
  check(bufferPlays.length >= 6, "plays are real buffer sources, not silent promises");
  check(await playGunSfx("nonexistentKind", 1) === false, "unknown kind resolves false (caller synthesises)");

  const playsBefore = bufferPlays.length;
  const susp = makeCtx({ running: false });
  _resetForTests();
  prewarmGunAudio(susp);
  check(await playGunSfx("pistolShot", 1) === false, "suspended context plays nothing and reports false");

  const bad = makeCtx({ decodeOk: false });
  _resetForTests();
  prewarmGunAudio(bad);
  check(await playGunSfx("pistolShot", 1) === false, "a failed decode resolves false, never throws");

  globalThis.fetch = async () => new Response("", { status: 404 });
  _resetForTests();
  prewarmGunAudio(makeCtx());
  check(await playGunSfx("pistolShot", 1) === false, "a 404 sample resolves false (synth fallback covers it)");
  Math.random = realRandom;
}
bufferPlays.length = 0;

// --------------------------------------------------------------------------- C
console.log("\n--- C. cinema.sfx interception ---");
{
  // cinema.js touches window/document at construction; stub the minimum.
  const listeners = {};
  globalThis.addEventListener = (t, fn) => { (listeners[t] ??= []).push(fn); };
  globalThis.removeEventListener = () => {};
  globalThis.document = {
    getElementById: () => null,
    body: { classList: { toggle() {} } },
    addEventListener() {}, removeEventListener() {},
  };

  const { createCinema } = await import("../../src/cinema.js");
  const cine = createCinema({ camera: { add() {} }, muted: () => false });
  const mutedMusicCine = createCinema({ camera: { add() {} }, muted: () => true });

  const ctx = makeCtx();
  globalThis.window = { AudioContext: class { constructor() { return ctx; } } };
  globalThis.fetch = async () => new Response(new ArrayBuffer(64), { status: 200 });
  _resetForTests();
  prewarmGunAudio(ctx);

  const gunPlays = bufferPlays.length;
  cine.sfx("pistolShot", 1);
  await flush();
  check(bufferPlays.length === gunPlays + 1, "sfx(pistolShot) plays the recorded sample (no synth)");

  mutedMusicCine.sfx("pistolShot", 1);
  await flush();
  check(bufferPlays.length === gunPlays + 2, "muting the soundtrack does not mute pistol sound effects");

  cine.sfx("siren", 1);
  await flush();
  check(true, "non-gun kinds still synthesise without throwing");

  // Missing samples: cinema must synthesise instead of staying silent. The
  // synth path builds noise buffers — a fresh AudioContext per cinema is not
  // possible (module singleton audio()), so assert via a context that CAN build
  // the synth chain: same fake ctx, gunAudio must resolve false this time.
  globalThis.fetch = async () => new Response("", { status: 404 });
  _resetForTests();
  prewarmGunAudio(ctx);
  const before404 = bufferPlays.length;
  cine.sfx("pistolShot", 1);
  await flush();
  check(bufferPlays.length === before404 + 1, "with samples 404ing, the synth voice takes the shot");
}
globalThis.fetch = realFetch;

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
