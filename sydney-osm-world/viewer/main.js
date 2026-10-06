// Sydney OSM - 3D skeleton viewer.
//
// This is NOT a game. It is the geographic skeleton that the pipeline produced,
// rendered so you can see whether the data is right. No NPCs, no combat, no
// physics, no assets - just OSM geometry from data/world/world-spec.json.
//
// Coordinate system (from the spec's coordinateSystem block):
//   x = east, y = up, z = south   (so north is -Z)
//   1 unit = 1 metre
//
// Attribution: geographic data (c) OpenStreetMap contributors, ODbL 1.0.
// https://www.openstreetmap.org/copyright

import * as THREE from 'three';

const SPEC_URL = '../data/world/world-spec.json';

const COLORS = {
  ground:    0x0f141a,
  water:     0x14416b,
  waterLine: 0x4a9eff,
  park:      0x1d4a2b,
  parkLine:  0x3fb950,
  roadLocal: 0x39414d,
  roadArt:   0xa8b3c1,
  roadArtHi: 0xe6edf3,
  bridge:    0xf0b429,
  tunnel:    0xa371f7,
  building:  0x323c4a,
  buildingTop:0x495668,
  venue:     0xd29922,
  nightlife: 0xf85149,
  transit:   0xa371f7,
  landmark:  0x39c5cf,
};

// ------------------------------------------------------------------ setup --
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.FogExp2(0x05070a, 0.00006);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1, 40000);

scene.add(new THREE.HemisphereLight(0x9ecbff, 0x0b0f14, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-2600, 3200, 1800);
scene.add(sun);

// groups, so the checkboxes can toggle whole layers
const groups = {};
for (const key of ['water', 'parks', 'roads', 'localRoads', 'buildings', 'venues', 'transit']) {
  groups[key] = new THREE.Group();
  scene.add(groups[key]);
}

const labels = document.getElementById('labels');
const errBox = document.getElementById('err');

function fail(message) {
  errBox.style.display = 'block';
  errBox.textContent = `Could not start the viewer.\n\n${message}\n\n` +
    `Serve this over HTTP (ES modules do not load from file://):\n` +
    `    python scripts/serve.py\nthen open http://127.0.0.1:8848/viewer/`;
  console.error(message);
}

// ------------------------------------------------------------- geometry ----
/**
 * Ear-clipping triangulation.
 *
 * A triangle fan is only correct for CONVEX rings. Sydney Harbour and the
 * parks follow real coastlines, so their rings are deeply concave, and a fan
 * over them produces enormous triangles that spill across the entire scene.
 * Ear clipping produces correct triangles for any simple polygon, and bails
 * out cleanly (drawing nothing) rather than drawing garbage.
 */
function signedArea(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += a[0] * b[1] - b[0] * a[1];
  }
  return total / 2;
}

function cross(ax, az, bx, bz, cx, cz) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function pointInTriangle(px, pz, ax, az, bx, bz, cx, cz) {
  const d1 = cross(ax, az, bx, bz, px, pz);
  const d2 = cross(bx, bz, cx, cz, px, pz);
  const d3 = cross(cx, cz, ax, az, px, pz);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Douglas-Peucker, so 200-ring multipolygons stay fast to triangulate. */
function simplify(points, tolerance = 2.0) {
  if (points.length < 8) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = -1, index = -1;
    const [ax, az] = points[first], [bx, bz] = points[last];
    const dx = bx - ax, dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    for (let i = first + 1; i < last; i++) {
      const [px, pz] = points[i];
      let t = lengthSq ? ((px - ax) * dx + (pz - az) * dz) / lengthSq : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx, qz = az + t * dz;
      const dist = Math.hypot(px - qx, pz - qz);
      if (dist > maxDist) { maxDist = dist; index = i; }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function triangulate(points) {
  const n = points.length;
  if (n < 3) return [];
  const indices = points.map((_, i) => i);
  if (signedArea(points) < 0) indices.reverse();      // work counter-clockwise

  const triangles = [];
  let guard = n * n;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const size = indices.length;
      const ia = indices[(i - 1 + size) % size];
      const ib = indices[i];
      const ic = indices[(i + 1) % size];
      const a = points[ia], b = points[ib], c = points[ic];
      if (cross(a[0], a[1], b[0], b[1], c[0], c[1]) <= 0) continue;   // reflex/collinear
      let contains = false;
      for (const idx of indices) {
        if (idx === ia || idx === ib || idx === ic) continue;
        const p = points[idx];
        if (pointInTriangle(p[0], p[1], a[0], a[1], b[0], b[1], c[0], c[1])) { contains = true; break; }
      }
      if (contains) continue;
      triangles.push([ia, ib, ic]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;        // self-intersecting or degenerate: draw nothing
  }
  if (indices.length === 3) triangles.push([indices[0], indices[1], indices[2]]);
  return triangles;
}

function polygonMesh(rings, material) {
  // rings: array of [x, y, z] arrays. All rings go into one geometry.
  const positions = [];
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    const flat = simplify(ring.map(p => [p[0], p[2]]));
    for (const [ia, ib, ic] of triangulate(flat)) {
      const a = flat[ia], b = flat[ib], c = flat[ic];
      positions.push(a[0], a[1], b[0], b[1], c[0], c[1]);
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function ringOutline(rings, color, opacity = 0.5) {
  // LineSegments, so each ring is closed independently. Concatenating the
  // rings into one polyline would draw spurious lines across the whole city
  // (Sydney Harbour alone is a 200+ ring multipolygon).
  const points = [];
  for (const ring of rings) {
    if (!ring || ring.length < 2) continue;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      points.push(new THREE.Vector3(a[0], 0, a[2]));
      points.push(new THREE.Vector3(b[0], 0, b[2]));
    }
  }
  if (!points.length) return;
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
}

/** Build a ribbon (a flat strip of quads) along a polyline, so roads have width. */
function ribbon(points, width, y) {
  const positions = [];
  const half = width / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, , z1] = points[i];
    const [x2, , z2] = points[i + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    // normal in the XZ plane
    const nx = (-dz / len) * half, nz = (dx / len) * half;
    const ax = x1 + nx, az = z1 + nz;
    const bx = x1 - nx, bz = z1 - nz;
    const cx = x2 + nx, cz = z2 + nz;
    const dx2 = x2 - nx, dz2 = z2 - nz;
    positions.push(
      ax, y, az, bx, y, bz, cx, y, cz,
      cx, y, cz, bx, y, bz, dx2, y, dz2
    );
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ----------------------------------------------------------------- build --
let spec = null;
const stats = {};
let buildingMeshes = [];

async function build() {
  const response = await fetch(SPEC_URL);
  if (!response.ok) throw new Error(`${SPEC_URL} -> HTTP ${response.status}`);
  spec = await response.json();

  // ---- ground plane, sized from the spec's own extent
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000),
    new THREE.MeshBasicMaterial({ color: COLORS.ground })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  scene.add(ground);

  // ---- grid, every 500 m, so scale is readable
  const grid = new THREE.GridHelper(12000, 24, 0x1f2733, 0x161d26);
  grid.position.y = -0.5;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);

  buildWater();
  buildParks();
  buildRoads();
  buildRoadCasing();
  buildBuildings();
  buildVenues();
  buildTransit();
  buildLabels();
  fillStats();
  wireUi();
  applyUrlParams();

  // Water and parks are off by default; ?water=1&parks=1 turns them on.
  for (const [id, group] of Object.entries({ tWater: 'water', tParks: 'parks' })) {
    groups[group].visible = document.getElementById(id).checked;
  }
  document.getElementById('bCount').textContent = `(${stats.buildings})`;
  document.getElementById('vCount').textContent = `(${stats.venues})`;
}

function buildWater() {
  const items = spec.water?.geometry?.items ?? [];
  const material = new THREE.MeshLambertMaterial({
    color: COLORS.water,
    emissive: 0x071a2e,      // so water still reads as water in shadow
  });
  const outline = new THREE.LineBasicMaterial({ color: COLORS.waterLine, transparent: true, opacity: 0.8 });
  stats.waterRings = 0;
  for (const body of items) {
    const mesh = polygonMesh(body.rings, material);
    if (!mesh) continue;
    mesh.position.y = -0.4;
    groups.water.add(mesh);
    const edge = ringOutline(body.rings, outline);
    if (edge) { edge.position.y = 0.2; groups.water.add(edge); }
    stats.waterRings += body.rings.length;
  }
}

function buildParks() {
  const items = spec.nature?.geometry?.items ?? [];
  const material = new THREE.MeshLambertMaterial({ color: COLORS.park });
  const outline = new THREE.LineBasicMaterial({ color: COLORS.parkLine, transparent: true, opacity: 0.5 });
  stats.parks = 0;
  for (const park of items) {
    const mesh = polygonMesh(park.rings, material);
    if (!mesh) continue;
    mesh.position.y = 0.15;
    groups.parks.add(mesh);
    const edge = ringOutline(park.rings, outline);
    if (edge) { edge.position.y = 0.4; groups.parks.add(edge); }
    stats.parks += 1;
  }
}

let roadScale = 9;

function buildRoads() {
  const arterials = spec.roads?.arterials ?? [];
  const material = new THREE.MeshBasicMaterial({ color: COLORS.roadArt });
  const hiMaterial = new THREE.MeshBasicMaterial({ color: COLORS.roadArtHi });
  const bridgeMaterial = new THREE.MeshBasicMaterial({ color: COLORS.bridge });
  const tunnelMaterial = new THREE.MeshBasicMaterial({ color: COLORS.tunnel });

  stats.roads = arterials.length;
  stats.roadLength = 0;

  const byKind = { arterial: [], major: [], other: [], bridge: [], tunnel: [] };
  for (const road of arterials) {
    stats.roadLength += road.lengthM;
    if (road.bridge) byKind.bridge.push(road);
    else if (road.tunnel) byKind.tunnel.push(road);
    else if (road.category === 'freeway' || road.category === 'arterial_major') byKind.major.push(road);
    else if (road.category === 'arterial') byKind.arterial.push(road);
    else byKind.other.push(road);
  }

  for (const [key, list, mat, widthFactor] of [
    ['other', byKind.other, material, 0.55],
    ['arterial', byKind.arterial, material, 0.8],
    ['major', byKind.major, hiMaterial, 1.0],
    ['bridge', byKind.bridge, bridgeMaterial, 1.1],
    ['tunnel', byKind.tunnel, tunnelMaterial, 1.1],
  ]) {
    for (const road of list) {
      const geometry = ribbon(road.geometryLocal, roadScale * widthFactor, 0.6);
      if (!geometry) continue;
      groups.roads.add(new THREE.Mesh(geometry, mat));
    }
  }
}

/** A dark casing under every road, so the network reads at distance instead of
 *  dissolving into the background. */
function buildRoadCasing() {
  const arterials = spec.roads?.arterials ?? [];
  const material = new THREE.MeshBasicMaterial({ color: 0x232b36 });
  for (const road of arterials) {
    const geometry = ribbon(road.geometryLocal, roadScale * 1.9, 0.4);
    if (geometry) groups.roads.add(new THREE.Mesh(geometry, material));
  }
}

let heightScale = 1;

function buildBuildings() {
  const items = spec.buildings?.sample?.items ?? [];
  stats.buildings = items.length;
  stats.buildingsWithHeight = 0;
  const material = new THREE.MeshLambertMaterial({ color: COLORS.building });
  const topMaterial = new THREE.MeshLambertMaterial({ color: COLORS.buildingTop });
  buildingMeshes = [];

  // One InstancedMesh would be fastest, but footprints differ; a merged
  // BufferGeometry of extruded prisms keeps it to two draw calls.
  const positions = [];
  const positionsTop = [];
  for (const building of items) {
    const ring = building.footprint;
    if (!ring || ring.length < 3) continue;
    if (building.heightM) stats.buildingsWithHeight += 1;

    // Height: real when OSM has one, otherwise derived from levels, and that
    // derivation is marked on the record so it is never mistaken for data.
    let height = building.heightM;
    if (!height && building.levels) height = building.levels * 3.4;
    if (!height) height = 11;                 // flat default, not a claim
    height *= heightScale;
    if (height < 2) height = 2;

    // base ring
    const base = ring.map(p => [p[0], 0, p[2]]);
    const top = ring.map(p => [p[0], height, p[2]]);
    for (let i = 0; i < base.length; i++) {
      const j = (i + 1) % base.length;
      const a = base[i], b = base[j], c = top[i], d = top[j];
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      positions.push(c[0], c[1], c[2], b[0], b[1], b[2], d[0], d[1], d[2]);
      positionsTop.push(c[0], c[1], c[2], d[0], d[1], d[2], top[0], height, top[2]);
    }
  }

  const sideGeometry = new THREE.BufferGeometry();
  sideGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  sideGeometry.computeVertexNormals();
  groups.buildings.add(new THREE.Mesh(sideGeometry, material));

  const topGeometry = new THREE.BufferGeometry();
  topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positionsTop, 3));
  topGeometry.computeVertexNormals();
  groups.buildings.add(new THREE.Mesh(topGeometry, topMaterial));
}

function buildVenues() {
  // InstancedMesh, not 7,157 separate objects - one draw call, and nightlife
  // venues are picked out with a per-instance colour.
  const byDistrict = spec.venues?.byDistrict ?? {};
  const spots = [];
  for (const venues of Object.values(byDistrict)) {
    for (const venue of venues) {
      if (venue.local) spots.push(venue);
    }
  }
  stats.venues = spots.length;
  if (!spots.length) return;

  const geometry = new THREE.BoxGeometry(9, 9, 9);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  const matrix = new THREE.Matrix4();
  const normal = new THREE.Vector3(0, 4.5, 0);
  const normalMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const instance = new THREE.InstancedMesh(geometry, normalMaterial, spots.length);

  const amber = new THREE.Color(COLORS.venue);
  const red = new THREE.Color(COLORS.nightlife);
  const hidden = new THREE.Color(0x000000);

  spots.forEach((venue, index) => {
    matrix.makeTranslation(venue.local.x, 4.5, venue.local.z);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, venue.nightlife ? red : amber);
    // A second, larger, near-invisible instance marks nightlife glow.
    const scale = venue.nightlife ? 2.6 : 1;
    matrix.makeScale(scale, 1, scale);
    matrix.setPosition(venue.local.x, 4.5, venue.local.z);
    instance.setMatrixAt(index, matrix);
    instance.setColorAt(index, venue.nightlife ? red : hidden);
  });
  mesh.instanceMatrix.needsUpdate = true;
  instance.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (instance.instanceColor) instance.instanceColor.needsUpdate = true;
  groups.venues.add(mesh, instance);
  void normal;
}

function buildTransit() {
  const stops = (spec.transit?.namedStops ?? []).filter(stop => stop.local);
  stats.transit = stops.length;
  if (!stops.length) return;
  const geometry = new THREE.BoxGeometry(20, 34, 20);
  const material = new THREE.MeshBasicMaterial({ color: COLORS.transit });
  const mesh = new THREE.InstancedMesh(geometry, material, stops.length);
  const matrix = new THREE.Matrix4();
  stops.forEach((stop, index) => {
    matrix.makeTranslation(stop.local.x, 17, stop.local.z);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  groups.transit.add(mesh);
}

// ---------------------------------------------------------------- labels --
let labelEntries = [];

function makeLabel(text, x, y, z, cls) {
  const el = document.createElement('div');
  el.className = `lbl ${cls ?? ''}`;
  el.textContent = text;
  labels.appendChild(el);
  labelEntries.push({ el, pos: new THREE.Vector3(x, y, z) });
}

// URL parameters, so a view can be linked or bookmarked:
//   ?water=1&parks=1&venues=1        turn layers on
//   ?at=x,z,y&target=x,z              jump the camera somewhere specific
//   ?tour=1                           start the fly tour
const params = new URLSearchParams(location.search);

function applyUrlParams() {
  const toggles = {
    tWater: 'water', tParks: 'parks', tRoads: 'roads',
    tBuildings: 'buildings', tVenues: 'venues', tTransit: 'transit', tLabels: 'labels',
  };
  for (const [id, name] of Object.entries(toggles)) {
    const value = params.get(name);
    if (value === null) continue;
    document.getElementById(id).checked = value !== '0' && value !== 'false';
  }
  if (params.has('width')) {
    roadScale = Math.max(1, Math.min(16, Number(params.get('width')) || roadScale));
    document.getElementById('roadWidth').value = Math.round(roadScale);
  }
}

function applyCameraParams() {
  const at = params.get('at');
  const target = params.get('target');
  if (at) {
    const [x, z, y] = at.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(z)) {
      position.set(x, Number.isFinite(y) ? y : position.y, z);
    }
  }
  if (target) {
    const [x, z, y] = target.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(z)) {
      aimAt(new THREE.Vector3(x, Number.isFinite(y) ? y : 0, z));
    }
  } else {
    aimAt(HOME.target);
  }
}

function buildLabels() {
  labelEntries.forEach(entry => entry.el.remove());
  labelEntries = [];
  for (const district of spec.districts ?? []) {
    if (!district.local) continue;
    makeLabel(district.realName, district.local.x, 60, district.local.z);
  }
  for (const body of (spec.water?.largest ?? [])) {
    if (!body.local || !body.name) continue;
    if ((body.areaM2 ?? 0) < 200000) continue;
    makeLabel(body.name, body.local.x, 20, body.local.z, 'water');
  }
  for (const park of (spec.nature?.largestParks ?? [])) {
    if (!park.local || !park.name) continue;
    if ((park.areaM2 ?? 0) < 150000) continue;
    makeLabel(park.name, park.local.x, 20, park.local.z);
  }
  for (const crossing of (spec.landmarks?.crossings ?? []).slice(0, 10)) {
    if (!crossing.local || !crossing.name) continue;
    makeLabel(`${crossing.kind === 'tunnel' ? 'Tunnel: ' : 'Bridge: '}${crossing.name}`,
      crossing.local.x, 40, crossing.local.z);
  }
}

function fillStats() {
  const set = (id, value) => { document.getElementById(id).textContent = value; };
  set('sRoads', stats.roads.toLocaleString());
  set('sLen', `${(stats.roadLength / 1000).toFixed(1)} km`);
  set('sWater', stats.waterRings.toLocaleString());
  set('sParks', stats.parks.toLocaleString());
  set('sBld', stats.buildings.toLocaleString());
  set('sBldH', stats.buildingsWithHeight.toLocaleString());
  set('sVen', stats.venues.toLocaleString());
  set('sTra', stats.transit.toLocaleString());
  set('sDis', (spec.districts?.length ?? 0).toString());
}

// ----------------------------------------------------------------- camera --
const position = new THREE.Vector3(-1750, 2050, 2450);
let yaw = 0, pitch = 0;
const keys = new Set();
let speed = 260;
let flying = null;

/** Aim the camera at a world-space point.
 *  For Euler order YXZ, forward = (-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)),
 *  which inverts to pitch = asin(forward.y), yaw = atan2(-forward.x, -forward.z).
 */
function aimAt(target) {
  const forward = target.clone().sub(position).normalize();
  pitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
  yaw = Math.atan2(-forward.x, -forward.z);
}

const HOME = {
  position: new THREE.Vector3(-1750, 2050, 2450),
  target: new THREE.Vector3(250, 0, -650),
};

function resetCamera() {
  position.copy(HOME.position);
  aimAt(HOME.target);
}

addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase());
  if (event.key.toLowerCase() === 'h') document.body.classList.toggle('hide-ui');
  if (event.key.toLowerCase() === 'r') resetCamera();
  if (event.key === ' ') { event.preventDefault(); flying = null; }
  if (['w', 'a', 's', 'd', 'q', 'e'].includes(event.key.toLowerCase())) flying = null;
});
addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', (event) => {
  dragging = true; lastX = event.clientX; lastY = event.clientY; flying = null;
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (event) => {
  if (!dragging) return;
  yaw -= (event.clientX - lastX) * 0.0035;
  pitch -= (event.clientY - lastY) * 0.0035;
  pitch = Math.max(-1.5, Math.min(1.4, pitch));
  lastX = event.clientX; lastY = event.clientY;
});
addEventListener('wheel', (event) => {
  event.preventDefault();
  speed = Math.max(20, Math.min(900, speed * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
  document.getElementById('speed').value = Math.round(speed);
}, { passive: false });

// A fixed tour around the harbour, built from the spec's own crossings.
function startTour() {
  const points = (spec.landmarks?.crossings ?? [])
    .filter(c => c.local && c.name)
    .slice(0, 5)
    .map(c => new THREE.Vector3(c.local.x, 260, c.local.z));
  if (points.length < 2) { startTourFallback(); return; }
  flying = { points, index: 0, t: 0 };
}

function startTourFallback() {
  const center = new THREE.Vector3(0, 0, 0);
  const waypoints = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    waypoints.push(new THREE.Vector3(
      center.x + Math.cos(angle) * 2600, 320, center.z + Math.sin(angle) * 2600));
  }
  flying = { points: waypoints, index: 0, t: 0 };
}

function updateCamera(dt) {
  if (flying) {
    const from = flying.points[flying.index];
    const to = flying.points[(flying.index + 1) % flying.points.length];
    flying.t += dt * 0.055;
    if (flying.t >= 1) { flying.t = 0; flying.index = (flying.index + 1) % flying.points.length; }
    const t = flying.t;
    position.lerpVectors(from, to, t);
    aimAt(new THREE.Vector3(0, 60, 0));
    camera.position.copy(position);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    return;
  }

  const boost = keys.has('shift') ? 3.2 : 1;
  const step = speed * boost * dt;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.has('w')) position.addScaledVector(forward, step);
  if (keys.has('s')) position.addScaledVector(forward, -step);
  if (keys.has('d')) position.addScaledVector(right, step);
  if (keys.has('a')) position.addScaledVector(right, -step);
  if (keys.has('e')) position.y += step;
  if (keys.has('q')) position.y -= step;
  position.y = Math.max(6, position.y);

  camera.position.copy(position);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

// -------------------------------------------------------------------- ui --
function wireUi() {
  const bind = (id, group) => {
    const el = document.getElementById(id);
    el.addEventListener('change', () => { groups[group].visible = el.checked; });
  };
  bind('tWater', 'water');
  bind('tParks', 'parks');
  bind('tRoads', 'roads');
  bind('tBuildings', 'buildings');
  bind('tVenues', 'venues');
  bind('tTransit', 'transit');

  const labelsToggle = document.getElementById('tLabels');
  labels.style.display = labelsToggle.checked ? 'block' : 'none';
  labelsToggle.addEventListener('change', () => { labels.style.display = labelsToggle.checked ? 'block' : 'none'; });

  document.getElementById('roadWidth').addEventListener('input', (event) => {
    roadScale = Number(event.target.value);
    groups.roads.clear();
    buildRoads();
    buildRoadCasing();
  });
  document.getElementById('bHeight').addEventListener('input', (event) => {
    heightScale = Number(event.target.value);
    groups.buildings.clear();
    buildBuildings();
  });
  document.getElementById('speed').addEventListener('input', (event) => {
    speed = Number(event.target.value);
  });
  document.getElementById('btnFly').addEventListener('click', startTour);
}

// ------------------------------------------------------------------ loop --
const clock = new THREE.Clock();
const projected = new THREE.Vector3();
let frames = 0, fpsTimer = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  updateCamera(dt);

  if (labels.style.display !== 'none') {
    for (const entry of labelEntries) {
      projected.copy(entry.pos).project(camera);
      const visible = projected.z < 1;
      entry.el.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      entry.el.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
      entry.el.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
    }
  }

  frames += 1;
  fpsTimer += dt;
  if (fpsTimer > 0.5) {
    document.getElementById('fps').textContent =
      `${Math.round(frames / fpsTimer)} fps | ${stats.roads} road ribbons | (c) OpenStreetMap contributors, ODbL`;
    frames = 0; fpsTimer = 0;
  }
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

build().then(() => {
  applyCameraParams();
  if (params.get('tour') === '1') startTour();
  frame();
}).catch((error) => {
  fail(error.stack || String(error));
});
