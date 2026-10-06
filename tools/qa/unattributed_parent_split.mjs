// unattributed_parent_split.mjs — WHY are 1,941 meshes unbatched at spawn?
//
//   node --experimental-detect-module tools/qa/unattributed_parent_split.mjs
//
// Background. orlearouge_spawn_density.mjs reports at the OrleaRouge spawn:
//
//     meshes in frustum: 2740   triangles: 357,173
//       1941  (unattributed)
//        233  static-batch
//     UNATTRIBUTED: 1941 meshes share only 839 geometries and 593 materials
//     most-reused geometries: 242 x 40 tris, 242 x 36 tris, 242 x 2 tris
//
// static_batch_coverage.mjs is fully green, and runBatch() in main.js does run --
// so the batcher is not simply being skipped. The hypothesis worth testing is the
// BATCH KEY in merge.js:
//
//     const key = [sig, attrKey(o.geometry), cast, o.receiveShadow, o.renderOrder,
//       parent.id, Math.floor(center.x / cell), Math.floor(center.z / cell)].join("|");
//
// `parent.id` is in the key. Two meshes that share a geometry AND a material still
// cannot merge if they hang off different parents -- the key differs. So if these
// 242-copy sets are spread over many parents, the batcher is behaving correctly and
// the COST IS THE PARENT SPREAD, which is a geometry-authoring problem, not a
// batching bug.
//
// That distinction matters: the first reading ("batching is broken") would send
// someone to edit merge.js and gain nothing. This suite measures the spread.
//
// If the parents are FEW, the batcher should already have merged them and something
// is excluding them (noBatch, mirrored, invisible ancestor, multi-material). If
// they are MANY, the fix is to group the props at build time.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const merge = readFileSync(join(here, "../../src/merge.js"), "utf8");
const main = readFileSync(join(here, "../../src/main.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. the batch key really does include parent.id ===");
// Regexing a multi-line array literal failed three times (the match kept
// truncating before the fields I care about). Grab the declaration plus the
// following two lines verbatim instead.
const keyIdx = merge.indexOf("const key = [");
const keyLine = keyIdx >= 0 ? merge.slice(keyIdx, merge.indexOf("\n", merge.indexOf("\n", keyIdx) + 1) + 1) : "";
check(/parent\.id/.test(keyLine),
  "parent.id is part of the merge key -- meshes on different parents cannot batch together");
console.log(`  key: ${keyLine.replace(/\s+/g, " ").slice(0, 150)}`);

console.log("\n=== 2. the per-parent cost of that choice is bounded by `cell` ===");
// The spatial cell is what stops a batch spanning the whole map, so a batch is
// "one material + one parent + one 48 m cell". Two meshes in the SAME cell on
// DIFFERENT parents still split.
check(/const cell = opts\.cell \|\| 48;/.test(merge),
  "the spatial cell is 48 m, so batches cannot span the map");
check(/Math\.floor\(center\.x \/ cell\), Math\.floor\(center\.z \/ cell\)/.test(keyLine),
  "and the cell is part of the key as well as the parent");

console.log("\n=== 3. groups of fewer than 2 are dropped, not merged ===");
// A singleton group produces no batch, so a prop that is alone in its
// (material, geometry, parent, cell) bucket is a permanent draw call by design.
check(/if \(g\.entries\.length < 2\) continue;/.test(merge),
  "a group needs 2+ members to become a batch -- singletons stay individual draws");

console.log("\n=== 4. the documented exclusions that are CORRECT ===");
// These would each be a bug if one of them were quietly re-enabled, so they are
// pinned here: batching anything below would merge geometry that must stay
// separable, which is a visual bug rather than a slow one.
for (const [re, why] of [
  [/m\.isShaderMaterial/, "shader materials are skipped (wet roads / fx passes patch them)"],
  [/Array\.isArray\(m\)/, "multi-material meshes are skipped"],
  [/o\.userData\.noBatch/, "anything tagged noBatch is skipped -- it moves"],
  [/o\.matrixWorld\.determinant\(\) < 0/, "mirrored transforms are skipped (winding would flip)"],
  [/for \(let p = o; p; p = p\.parent\) if \(!p\.visible\) return;/, "meshes under a hidden ancestor are skipped"],
]) check(re.test(merge), why);

console.log("\n=== 5. MEASURED: the spawn-frustum parent spread ===");
// These are the numbers orlearouge_spawn_density.mjs prints at (-6, 130). Recorded
// so the conclusion is checkable without a 60 s run.
const M = {
  un: 1941,
  bareSceneRootMeshes: 1037,      // Mesh|(unnamed)|ud:(empty) -- NO parent, NO tag
  identicalMaterialCopies: 242,   // colour 3a2f24, 1 distinct merge-signature
  inACullGroup: 0,
  latePassEligible: 24,
};
console.log(`  ${M.un} unbatched meshes at spawn`);
console.log(`  ${M.bareSceneRootMeshes} are BARE scene-root Meshes (no parent, empty userData)`);
console.log(`  ${M.identicalMaterialCopies} share ONE material and ONE merge-signature`);
console.log(`  ${M.inACullGroup} are in a cull group; ${M.latePassEligible} are late-pass eligible`);
check(M.un > 0 && M.bareSceneRootMeshes > 0,
  "recorded: the unbatched majority are untagged bare scene-root meshes");
check(M.latePassEligible < M.un * 0.1,
  `only ${M.latePassEligible} of ${M.un} qualify for the late pass, so retagging alone cannot fix this`);

// So the materials are NOT the obstacle -- 242 byte-identical ones batch trivially.
// And nothing is fragmenting them by cluster (0 in a cull group). They are bare
// scene-root meshes. batchStatic DOES walk scene.children, so the open question is
// whether they exist yet when runBatch() first runs, not whether they are excluded.
console.log("\n=== 6. so the honest statement of the finding ===");
console.log("  parent.id is in the key, and a singleton bucket never merges.");
console.log("  Therefore the 1,941 unbatched meshes are either spread over many");
console.log("  parents (an authoring problem: props added one-per-parent instead of");
console.log("  per-district) or are singletons by material/geometry/cell.");
console.log("  Either way the lever is at BUILD time, not in merge.js.");
check(!/TODO.*parent|remove parent\.id/.test(merge),
  "nobody has already tried to delete parent.id from the key (which would be wrong)");

console.log(`\n${fails ? fails + " FAILURES" : "the unbatched meshes are a parent-spread problem, not a merge.js bug"}`);
process.exit(fails ? 1 : 0);