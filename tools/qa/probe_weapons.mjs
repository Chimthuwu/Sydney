// Measure the weapon assets so orientation is derived, not guessed.
//
//   node tools/qa/probe_weapons.mjs
//
// The Tec-9 came out held backwards because the loader assumed every authored
// weapon already pointed down +Z, and the MAC-10 did not. Re-measuring is the
// only way to know about the next one, and this is the tool that does it.
//
// What it reports, per file:
//   - the overall extents in the file's own axis frame
//   - the LONG axis, and which sign of it the barrel is on
//   - the per-mesh extents, because a weapon's parts are named after what they
//     are ("bt" = barrel/bois, "derriere" = the rear, "magazine", "crosse" =
//     stock) and those names are the only reliable way to tell which end of
//     the long axis is the muzzle. The extent alone cannot: a symmetric barrel
//     looks the same pointing either way.
//
// Then it works out the rotY that puts the barrel on +Z (which is what the
// rig solves the weapon's +Z onto) and the length that fits the weapon to a
// real-world size.
import { readFileSync, existsSync } from "node:fs";

/** Parse a .glb (binary) or .gltf (JSON) into the glTF JSON. */
function readGltf(url) {
  if (!existsSync(url)) return null;
  if (url.endsWith(".gltf")) return JSON.parse(readFileSync(url, "utf8"));
  const buf = readFileSync(url);
  if (buf.readUInt32LE(0) !== 0x46546c67) return null;       // 'glTF'
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
}

/**
 * Every mesh's extents in the file's own frame, walked through the node tree
 * so that per-part offsets count. A flat scan of the accessors ignores that
 * `mac10magazine_low` hangs 12 cm below the receiver, and that is exactly the
 * part whose position tells you which way the gun faces.
 */
function partExtents(gltf) {
  const parts = [];
  const visit = (nodeIndex, parent) => {
    const n = gltf.nodes?.[nodeIndex];
    if (!n) return;
    const t = n.translation || [0, 0, 0];
    const s = n.scale || [1, 1, 1];
    const at = [parent[0] + t[0] * s[0], parent[1] + t[1] * s[1], parent[2] + t[2] * s[2]];
    if (n.mesh != null) {
      const mesh = gltf.meshes[n.mesh];
      for (const p of mesh.primitives || []) {
        const a = gltf.accessors?.[p.attributes?.POSITION];
        if (!a || !a.min || !a.max) continue;
        parts.push({
          name: n.name || mesh.name || "(unnamed)",
          min: [a.min[0] * s[0] + at[0], a.min[1] * s[1] + at[1], a.min[2] * s[2] + at[2]],
          max: [a.max[0] * s[0] + at[0], a.max[1] * s[1] + at[1], a.max[2] * s[2] + at[2]],
        });
      }
    }
    for (const c of n.children || []) visit(c, at);
  };
  for (const root of gltf.scenes?.[0]?.nodes || []) visit(root, [0, 0, 0]);
  return parts;
}

// Words that mean "this part is at the muzzle end" and "at the butt", in the
// several languages these packs are labelled in (the Styloo pack is French).
const MUZZLE_WORDS = ["barrel", "barrelmesh", "bt", "canon", "muzzle", "frontsight", "front_sight", "aim"];
const BUTT_WORDS = ["derriere", "rear", "butt", "stock", "crosse", "grip", "handle", "rearsight", "rear_sight", "pommette"];
// The trigger is the one part every one of these has, and it is the part that
// says two things at once: the barrel is the end AWAY from it, and the hand
// closes ON it. That second half is worth more than it looks — it is the grip
// point, measured rather than guessed, which is the number the loader needs.
const TRIGGER_WORDS = ["trigger", "gachette", "detente", "detente_low", "poignee"];

function classify(part) {
  const n = part.name.toLowerCase().replace(/[^a-z]/g, "");
  if (TRIGGER_WORDS.some((w) => n.includes(w))) return "trigger";
  if (MUZZLE_WORDS.some((w) => n.includes(w))) return "muzzle";
  if (BUTT_WORDS.some((w) => n.includes(w))) return "butt";
  return null;
}

const AXES = ["X", "Y", "Z"];

function measure(url) {
  const gltf = readGltf(url);
  if (!gltf) return null;
  const parts = partExtents(gltf);
  if (!parts.length) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.min[i]); hi[i] = Math.max(hi[i], p.max[i]); }
  }
  const size = [0, 1, 2].map((i) => hi[i] - lo[i]);
  const long = size.indexOf(Math.max(...size));
  // aspect: how elongated it is. A square blob is not a gun and should not be
  // treated as one.
  const sorted = [...size].sort((a, b) => b - a);
  const aspect = sorted[1] > 1e-6 ? sorted[0] / sorted[1] : 0;

  // which end is the muzzle, and where a hand closes
  const named = parts.map((p) => ({ p, kind: classify(p) })).filter((x) => x.kind);
  const centre = (part) => (part.min[long] + part.max[long]) / 2;
  const mid = (lo[long] + hi[long]) / 2;
  const extent = hi[long] - lo[long];
  let barrelSign = null, evidence = "", gripAt = null;

  const triggers = named.filter((x) => x.kind === "trigger");
  const muzzles = named.filter((x) => x.kind === "muzzle");
  const butts = named.filter((x) => x.kind === "butt");

  // The trigger is the best source of the GRIP point and a poor source of
  // direction: on a MAC-10 it sits at 0.50 along the gun, dead centre, so
  // "the end away from the trigger" is a coin flip and it came out backwards
  // the first time this ran. A NAMED part is direct evidence — `mac10derriere`
  // is French for "the rear" and is at -X, so the barrel is at +X.
  //
  // So: direction comes from a named barrel or butt if there is one, and only
  // falls back to the trigger when the trigger is actually off-centre (say,
  // more than 15% of the length from the middle, where the reading means
  // something). The grip point always comes from the trigger.
  if (muzzles.length) {
    const m = muzzles.reduce((a, b) => (centre(b.p) > centre(a.p) ? b : a));
    barrelSign = centre(m.p) > mid ? 1 : -1;
    evidence = `named barrel "${m.p.name}" at the ${barrelSign > 0 ? "+" : "-"}${AXES[long]} end`;
  } else if (butts.length) {
    const b = butts.reduce((a, b) => (centre(b.p) > centre(a.p) ? b : a));
    barrelSign = centre(b.p) > mid ? -1 : 1;
    evidence = `named butt "${b.p.name}" at the ${centre(b.p) > mid ? "+" : "-"}${AXES[long]} end`;
  } else if (triggers.length) {
    const t = triggers.reduce((a, b) => (centre(b.p) > centre(a.p) ? b : a));
    const f = (centre(t.p) - lo[long]) / extent;
    if (Math.abs(f - 0.5) < 0.15) {
      barrelSign = null;                    // dead centre: no information at all
      evidence = `trigger "${t.p.name}" at ${f.toFixed(2)} — dead centre, says nothing about direction`;
    } else {
      barrelSign = f > 0.5 ? -1 : 1;
      evidence = `trigger "${t.p.name}" at ${f.toFixed(2)} along the gun, so the barrel is the ${barrelSign > 0 ? "+" : "-"}${AXES[long]} end`;
    }
  }
  if (triggers.length) {
    const t = triggers.reduce((a, b) => (centre(b.p) > centre(a.p) ? b : a));
    gripAt = (centre(t.p) - lo[long]) / extent;
  }

  // the rotY that turns the barrel onto +Z. Rotating about Y takes +X -> +Z
  // with -90 deg, and -X -> +Z with +90.
  let rotY = null;
  if (barrelSign != null) {
    const local = barrelSign > 0 ? "+" : "-";
    if (long === 0) rotY = local === "+" ? -Math.PI / 2 : Math.PI / 2;
    else if (long === 1) rotY = null;                 // a vertical gun needs more than a yaw
    else rotY = 0;
  }

  return { url, lo, hi, size, long, aspect, barrelSign, rotY, evidence, gripAt, parts, named };
}

const TARGETS = [
  "assets/models/weapons/styloo/mac10.glb",
  "assets/models/weapons/styloo/ak47.glb",
  "assets/models/weapons/styloo/ak47variant.glb",
  "assets/models/weapons/styloo/awp.glb",
  "assets/models/weapons/styloo/shotgun.glb",
  "assets/models/weapons/styloo/pew.glb",
  "assets/models/weapons/styloo/board.glb",
  "assets/models/weapons/gangster_rifle/scene.gltf",
];

const f3 = (n) => n.toFixed(3).padStart(9);
for (const url of TARGETS) {
  const m = measure(url);
  if (!m) { console.log(`\n${url}\n  (could not read)`); continue; }
  const short = url.replace("assets/models/weapons/", "");
  console.log(`\n${short}`);
  console.log(`  extents   ${m.size.map(f3).join(" ")}   long axis ${AXES[m.long]}  aspect ${m.aspect.toFixed(2)}`);
  if (m.barrelSign == null) {
    console.log(`  barrel    UNKNOWN — no part names it; do not guess`);
  } else {
    console.log(`  barrel    ${m.barrelSign > 0 ? "+" : "-"}${AXES[m.long]}   -> rotY ${m.rotY == null ? "n/a (vertical model)" : (m.rotY / Math.PI).toFixed(2) + "π"}`);
    if (m.evidence) console.log(`  evidence  ${m.evidence}`);
  }
  if (m.gripAt != null) {
    // the loader centres the model then shifts by (0.5 - gripAt) * length, so
    // the fraction it needs to place the hand on the trigger is 1 - f.
    console.log(`  gripAt    ${m.gripAt.toFixed(3)} (hand on the trigger)  -> GLB_SKINS gripAt: ${(1 - m.gripAt).toFixed(3)}`);
  }
  // the parts, largest first, so the reader can sanity-check the classification
  const bySize = [...m.parts].sort((a, b) => {
    const sa = Math.max(...[0, 1, 2].map((i) => a.max[i] - a.min[i]));
    const sb = Math.max(...[0, 1, 2].map((i) => b.max[i] - b.min[i]));
    return sb - sa;
  }).slice(0, 8);
  for (const p of bySize) {
    const k = classify(p);
    console.log(`    ${p.name.padEnd(22)} ${[0, 1, 2].map((i) => f3(p.max[i] - p.min[i])).join(" ")}${k ? `   [${k}]` : ""}`);
  }
}
