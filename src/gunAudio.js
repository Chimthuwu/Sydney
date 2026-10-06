// ---------------------------------------------------------------------------
// gunAudio.js — recorded gunshot samples for cinema.sfx() (2026-09-27).
//
// The planarian BGM recordings are multi-shot session files, so single shots
// were sliced out with ffmpeg (silence-detected boundaries) into
// assets/audio/gun/: a0/a1/b0/b1 are pistol-calibre single shots, shotgun0 is
// the one clean 12-gauge boom, tec90/tec91 are two rapid-fire pops.
//
// `play(kind, volume)` is called by cinema.js's sfx() for the gun kinds BEFORE
// its synthesised voices; when the samples are loaded it returns true and the
// synth for that shot is skipped. Until prewarm() finishes (or if a file 404s)
// it returns false and the existing synth shot plays — so a missing file degrades
// to the old sound instead of silence, unlike the zombie SFX where the human
// ordered the synth retired outright.
//
// `trim` levels the slices to each other (ffmpeg astats peaks, 2026-09-27):
// a0 -9.7 dB, a1 -7.5, b0 -5.8, b1 -7.8, shotgun0 -0.6 (near full scale),
// tec90/tec91 -4.3. Pistol shots land ~0.3 peak; the shotgun ~0.55 (a boom
// should be the loudest thing on the range); the Tec-9 lands lighter per shot
// because its 0.13 s cooldown stacks fast.
// ---------------------------------------------------------------------------

const GUN_SFX = {
  pistolShot: [
    { path: "assets/audio/gun/a0.wav", trim: 0.98 },
    { path: "assets/audio/gun/a1.wav", trim: 0.75 },
    { path: "assets/audio/gun/b0.wav", trim: 0.62 },
    { path: "assets/audio/gun/b1.wav", trim: 0.78 },
  ],
  // the deer rifle reuses the pistol pool for now: the loudest, darkest slices
  // lead so it reads as a heavier round until a dedicated sample exists
  rifleShot: [
    { path: "assets/audio/gun/b0.wav", trim: 0.8 },
    { path: "assets/audio/gun/b1.wav", trim: 0.95 },
    { path: "assets/audio/gun/a0.wav", trim: 1.0 },
  ],
  shotgun: [
    { path: "assets/audio/gun/shotgun0.wav", trim: 0.55 },
  ],
  tec9Shot: [
    { path: "assets/audio/gun/tec90.wav", trim: 0.45 },
    { path: "assets/audio/gun/tec91.wav", trim: 0.45 },
  ],
};

const decoded = new Map();      // path -> AudioBuffer
const pending = new Map();      // path -> in-flight load promise (dedupes parallel fetches)
let ctx = null;
let prewarmed = false;

function load(ctx_, path) {
  if (decoded.has(path)) return Promise.resolve(decoded.get(path));
  if (pending.has(path)) return pending.get(path);
  const p = fetch(path)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((bytes) => ctx_.decodeAudioData(bytes))
    .then((buf) => { decoded.set(path, buf); pending.delete(path); return buf; })
    .catch(() => { pending.delete(path); return null; });   // missing file: the synth fallback handles it
  pending.set(path, p);
  return p;
}

/** Decode every sample once. Safe to call repeatedly and before any gesture. */
export function prewarmGunAudio(audioCtx) {
  if (!audioCtx || prewarmed) return;
  prewarmed = true;
  ctx = audioCtx;
  for (const pool of Object.values(GUN_SFX)) for (const s of pool) load(audioCtx, s.path);
}

/**
 * Play one recorded shot for `kind` at `volume` (the caller's already-scaled
 * gain). Resolves true when a sample was played, false when the caller should
 * use its synthesised voice instead.
 */
export function playGunSfx(kind, volume) {
  try {
    const pool = GUN_SFX[kind];
    if (!ctx || !pool || !pool.length) return Promise.resolve(false);
    const voice = pool[Math.min(pool.length - 1, (Math.random() * pool.length) | 0)];
    return load(ctx, voice.path).then((buf) => {
      if (!buf || ctx.state !== "running") return false;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf;
      g.gain.value = volume * voice.trim;
      src.connect(g); g.connect(ctx.destination);
      src.start();
      return true;
    }).catch(() => false);
  } catch (e) {
    return Promise.resolve(false);
  }
}

/** Test seam: the manifest (kind -> [{path, trim}]). */
export function gunSfxManifest() {
  return GUN_SFX;
}

/** Test seam only: drop the decoded/pending caches and the prewarm guard. */
export function _resetForTests() {
  decoded.clear();
  pending.clear();
  prewarmed = false;
  ctx = null;
}
