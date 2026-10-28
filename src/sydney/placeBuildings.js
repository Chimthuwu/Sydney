// src/sydney/placeBuildings.js — map real OSM footprints onto the voxel building set.
//
// Phase 2 of docs/SYDNEY_ASSET_WORKFLOW.md. Pure data: no Three.js, no IO.
// Returns a deterministic placement list so the city is byte-identical on every
// reload. The actual mesh loading/batching happens in content.js (Phase 3).

export const VOXEL_MODELS = [
  { id: 'Tiny_Building',     path: 'assets/models/voxel_buildings/Tiny_Building/TinyBuilding01.obj',     bucket: 'tiny' },
  { id: 'Small_Building_01', path: 'assets/models/voxel_buildings/Small_Building_01/SmallBuilding01.obj', bucket: 'small' },
  { id: 'Small_Building_02', path: 'assets/models/voxel_buildings/Small_Building_02/SmallBuilding02.obj', bucket: 'small' },
  { id: 'Small_Building_03', path: 'assets/models/voxel_buildings/Small_Building_03/SmallBuilding03.obj', bucket: 'small' },
  { id: 'Small_Building_04', path: 'assets/models/voxel_buildings/Small_Building_04/SmallBuilding04.obj', bucket: 'small' },
  { id: 'Large_Building_01', path: 'assets/models/voxel_buildings/Large_Building_01/LargeBuilding01.obj', bucket: 'large' },
  { id: 'Tall_Building_01',  path: 'assets/models/voxel_buildings/Tall_Building_01/TallBuilding01.obj',  bucket: 'tall' },
  { id: 'Tall_Building_02',  path: 'assets/models/voxel_buildings/Tall_Building_02/TallBuilding02.obj',  bucket: 'tall' },
  { id: 'Tall_Building_03',  path: 'assets/models/voxel_buildings/Tall_Building_03/TallBuilding03.obj',  bucket: 'tall' },
];

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function footprintArea(fp) {
  // shoelace, fp may repeat first point at end
  let pts = fp;
  const first = pts[0], last = pts[pts.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) pts = pts.slice(0, -1);
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function bucketFor(h) {
  if (h < 8) return 'tiny';
  if (h < 20) return 'small';
  if (h < 50) return 'large';
  return 'tall';
}

// principal axis rotation: 0 or PI/2 so model's long side aligns with footprint's
function principalRotation(fp) {
  let pts = fp;
  const first = pts[0], last = pts[pts.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) pts = pts.slice(0, -1);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const w = maxX - minX, d = maxZ - minZ;
  return w >= d ? 0 : Math.PI / 2;
}

export function placeBuildings(buildings) {
  const out = [];
  for (const b of buildings) {
    const fp = b.fp;
    if (!fp || fp.length < 3) continue;
    const h = b.h || 6;
    const bucket = bucketFor(h);
    const candidates = VOXEL_MODELS.filter(m => m.bucket === bucket);
    if (!candidates.length) continue;
    const seed = hashStr(String(b.name || '') + '|' + fp.map(p => p.join(',')).join(';'));
    const model = candidates[seed % candidates.length];
    const area = footprintArea(fp);
    // uniform scale: fit model's footprint to building's, using sqrt(area) as size proxy
    const size = Math.sqrt(area);
    const scale = Math.max(0.5, size / 8); // 8m nominal model footprint
    // centroid
    let pts = fp;
    const first = pts[0], last = pts[pts.length - 1];
    if (first && last && first[0] === last[0] && first[1] === last[1]) pts = pts.slice(0, -1);
    let cx = 0, cz = 0;
    for (const [x, z] of pts) { cx += x; cz += z; }
    cx /= pts.length; cz /= pts.length;
    out.push({
      model: model.id,
      path: model.path,
      bucket,
      x: cx,
      z: cz,
      rotation: principalRotation(fp),
      scale,
      height: h,
      name: b.name || null,
    });
  }
  return out;
}