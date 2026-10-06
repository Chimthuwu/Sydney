// The Crown Strip (TASK-070) — does it actually build?
//
//   node tools/qa/crown_build_test.mjs
//
// `crown_strip_test.mjs` checks the layout numbers; this one *executes* them. It runs
// the real `composer.js` and the real `crownstrip.js` in a `vm` sandbox with a stub
// three.js and calls the district's real `buildSet()`. That catches undefined
// identifiers, bad arguments, NaN transforms and venues that fail to build.
//
// What it is NOT: a browser. No GLB/FBX is loaded (the landmarks kit is stubbed),
// no shader compiles, and nothing is rendered — draw calls and the night look still
// need a real-browser pass.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
}
const inCrownRect = (r, x, z) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

// ------------------------------------------------------------------ stub three
// Proportional text metrics exercise neonsign.js's fitter. Drawing ops are no-ops;
// characters.js can run its procedural material/rig code without a renderer.
const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = {
  fillStyle: "", font: "", textAlign: "", textBaseline: "", shadowColor: "",
  shadowBlur: 0, lineWidth: 0, strokeStyle: "", globalAlpha: 1, lineCap: "", lineJoin: "",
  fillRect: noop, fillText: noop, strokeRect: noop, strokeText: noop,
  save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, setTransform: noop,
  beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, ellipse: noop,
  rect: noop, quadraticCurveTo: noop, bezierCurveTo: noop, arcTo: noop,
  fill: noop, stroke: noop, clip: noop, clearRect: noop, drawImage: noop, setLineDash: noop,
  createLinearGradient: () => gradient, createRadialGradient: () => gradient,
  createPattern: () => gradient, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: noop, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  measureText(s) {
    const m = /(\d+(?:\.\d+)?)px/.exec(this.font || "");
    const size = m ? parseFloat(m[1]) : 10;
    let em = 0; for (const ch of String(s)) em += ch === " " ? 0.32 : 0.64;
    return { width: em * size };
  },
};
const stubDocument = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context2d }),
  head: { appendChild() {} }, body: { appendChild() {} },
  getElementById: () => null, addEventListener() {},
};

function makeThree() {
  class V {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    setScalar(s) { return this.set(s, s, s); }
    copy(v) { return this.set(v.x, v.y, v.z); }
    clone() { return new V(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
    applyAxisAngle() { return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    normalize() { return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
    distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    applyMatrix4(m) { return m ? this.add(m.__t) : this; }
  }
  class E { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x=x; this.y=y; this.z=z; return this; } }
  class Q {
    constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
    setFromEuler() { return this; } setFromAxisAngle() { return this; }
    identity() { this.x=0; this.y=0; this.z=0; this.w=1; return this; }
    copy(q) { this.x=q.x; this.y=q.y; this.z=q.z; this.w=q.w; return this; }
  }
  class M4 {
    constructor() { this.__t = new V(); }
    identity() { this.__t.set(0, 0, 0); return this; }
    translate(x, y, z) { this.__t.set(x, y, z); return this; }
    premultiply(m) { this.__t.add(m.__t); return this; }
    multiply(m) { this.__t.add(m.__t); return this; }
    compose(p) { this.__t.copy(p); return this; }
    determinant() { return 1; }
    getMaxScaleOnAxis() { return 1; }
  }
  class Box3 {
    constructor() { this.min = new V(); this.max = new V(); }
    setFromObject() { return this; }
    getSize(v) { return v.set(1, 1, 1); }
    getCenter(v) { return v.set(0, 0, 0); }
    getBoundingSphere(s) { s.center.set(0, 0, 0); s.radius = 1; return s; }
  }
  class Sphere { constructor(center = new V(), radius = 0) { this.center = center; this.radius = radius; } }
  let uid = 0;
  class Obj3D {
    constructor() {
      this.id = ++uid; this.children = []; this.parent = null;
      this.position = new V(); this.rotation = new E(); this.scale = new V(1, 1, 1);
      this.visible = true; this.userData = {}; this.name = ""; this.type = "Object3D";
      this.matrix = new M4(); this.matrixWorld = new M4(); this.matrixAutoUpdate = true;
      this.quaternion = new Q(); this.castShadow = false; this.receiveShadow = false; this.renderOrder = 0;
    }
    add(...os) { for (const o of os) { if (!o) continue; o.parent = this; this.children.push(o); } return this; }
    remove(o) { const i = this.children.indexOf(o); if (i >= 0) { this.children.splice(i, 1); o.parent = null; } return this; }
    traverse(cb) { cb(this); for (const c of this.children) c.traverse(cb); }
    updateMatrix() { this.matrix.compose(this.position); return this; }
    updateMatrixWorld() { this.matrix.compose(this.position); this.matrixWorld.__t.copy(this.position); for (const c of this.children) c.updateMatrixWorld(); return this; }
    getObjectByName() { return null; }
    clone() { return this; }
    lookAt() {} addEventListener() {}
  }
  class Mesh extends Obj3D { constructor(geo, mat) { super(); this.isMesh = true; this.geometry = geo; this.material = mat; } }
  class InstancedMesh extends Mesh { constructor(geo, mat, n) { super(geo, mat); this.isInstancedMesh = true; this.count = n; } setMatrixAt() {} computeBoundingSphere() {} }
  class Geo {
    constructor() {
      // uv / normal as well as position: cityparts.js rewrites a tower's window
      // UVs through them, so a geometry stub without them is a stub the districts
      // cannot be built with.
      const buf = (n) => ({
        count: 1, array: new Float32Array(3),
        getX: () => 0, getY: () => 0, getZ: () => 0,
        setX: () => {}, setY: () => {}, setZ: () => {}, setXY: () => {},
      });
      this.attributes = { position: buf(3), normal: buf(3), uv: buf(2) };
      this.index = null; this.morphAttributes = {}; this.boundingSphere = null;
    }
    computeBoundingSphere() { this.boundingSphere = { center: new V(), radius: 1 }; }
    clone() { return new Geo(); } applyMatrix4() { return this; } rotateX() { return this; }
    translate() { this.bakedY = arguments[1] || 0; return this; }
  }
  const geo = (type) => class extends Geo { constructor(...a) { super(); this.type = type; this.parameters = { args: a }; } };
  class Col {
    constructor(hex) { this.hex = hex >>> 0; this.r = 1; this.g = 1; this.b = 1; }
    setHex(h) { this.hex = h >>> 0; return this; }
    getHexString() { return this.hex.toString(16).padStart(6, "0"); }
    setHSL() { return this; } getHSL(o) { return o || { h: 0, s: 0, l: 0 }; }
    lerp() { return this; } copy(c) { return this.setHex(c.hex); }
    clone() { return new Col(this.hex); } setRGB(r, g, b) { this.r=r; this.g=g; this.b=b; return this; }
    multiplyScalar() { return this; }
  }
  let muid = 0;
  class Material {
    constructor(o = {}) {
      this.uuid = "m" + (++muid); this.type = "MeshStandardMaterial";
      this.name=o.name || ""; this.color=new Col(o.color ?? 0xffffff); this.emissive=new Col(o.emissive ?? 0x000000);
      this.emissiveIntensity=o.emissiveIntensity ?? 1; this.roughness=o.roughness ?? 1; this.metalness=o.metalness ?? 0;
      this.map=o.map; this.transparent=!!o.transparent; this.opacity=o.opacity ?? 1; this.userData={ ...(o.userData || {}) };
    }
    clone() {
      const m = new Material({ name: this.name, color: this.color.hex });
      m.emissive=this.emissive; m.emissiveIntensity=this.emissiveIntensity; m.roughness=this.roughness;
      m.metalness=this.metalness; m.map=this.map; m.userData={ ...this.userData }; return m;
    }
    copy(m) { return this.clone(); }
    dispose() {}
  }
  class CanvasTexture { constructor(c) { this.image=c; this.repeat=new V(1,1); this.offset=new V(); } }
  return {
    Vector2: V, Vector3: V, Matrix4: M4, Quaternion: Q, Euler: E, Box3, Sphere, Material, Color: Col,
    Object3D: Obj3D, Group: class extends Obj3D {}, Mesh, InstancedMesh,
    BoxGeometry: geo("BoxGeometry"), CylinderGeometry: geo("CylinderGeometry"), SphereGeometry: geo("SphereGeometry"),
    ConeGeometry: geo("ConeGeometry"), PlaneGeometry: geo("PlaneGeometry"), TorusGeometry: geo("TorusGeometry"), CircleGeometry: geo("CircleGeometry"),
    // geo.js's chamfer addon is a vendored ES module this sandbox cannot
    // import; see `roundedBox` below for how the builders get their boxes.
    RoundedBoxGeometry: class extends geo("BoxGeometry") {
      constructor(w, h, d) { super(w, h, d); }
    },
    RepeatWrapping: 1000, MeshStandardMaterial: Material, MeshBasicMaterial: Material,
    CanvasTexture, SRGBColorSpace: "srgb",
    MathUtils: {
      clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
      smoothstep: (x, a, b) => { const t = Math.min(1, Math.max(0, (x-a)/(b-a))); return t*t*(3-2*t); },
      lerp: (a, b, t) => a + (b-a)*t,
    },
  };
}

// ------------------------------------------------------------------ sandbox
const calls = { blockers: 0, litSpots: 0, services: 0 };
const blockers = [];
const litSpots = [];
const reflected = [];
const serviceCall = [];
const actorMeshes = (code) => vm.runInContext(
  `(() => { let n=0; const a=${code}; a.traverse((o) => { if(o.isMesh) n++; }); return n; })()`, sandbox, { filename: "probe" });
const scene = {
  children: [], visible: true,
  add(...os) { for (const o of os) if (o) { o.parent=scene; scene.children.push(o); } },
  remove(o) { const i=scene.children.indexOf(o); if (i>=0) { scene.children.splice(i,1); o.parent=null; } },
  updateMatrixWorld() {}, traverse(cb) { cb(scene); for (const c of scene.children) c.traverse(cb); },
};
const sandbox = {
  console, setTimeout, clearTimeout, THREE: makeThree(), document: stubDocument,
  mergeGeometries: () => new sandbox.THREE.BoxGeometry(),
  // characters.js builds every box through geo.js's roundedBox, and geo.js
  // cannot be concatenated into this sandbox (it declares `box`, which
  // characters.js declares too). Nothing here checks a bevel — the checks are
  // placement, collision, reach and the crowd — so a plain box of the same
  // dimensions is the honest stand-in.
  roundedBox: (w, h, d) => new sandbox.THREE.BoxGeometry(w, h, d),
  // The two kit factories the strip's fill pass calls. They are the districts'
  // own geometry factories rather than anything the strip audits, and both reach
  // for parts of three this stub does not carry (Shape, ExtrudeGeometry, the
  // texture atlas), so they are stood in for here. Everything this test checks —
  // the venues, their fixtures, their people and the walkable lanes — is built
  // by interiors.js and crowd.js, which are loaded in full below.
  createTownKit: () => ({
    // The kit's shop/house builders are used two ways: `shops.brickBlock(opts)`
    // hands the composer a build function, and `shops.warehouse({...})` is handed
    // to `mix` as one — so the stub has to be a function that RETURNS a
    // function, not one that returns nothing.
    shops: new Proxy({}, { get: () => () => () => {} }),
    block: () => {},
    houses: new Proxy({}, { get: () => () => () => {} }), hash: () => 0, mat: () => new sandbox.THREE.MeshStandardMaterial({}),
  }),
  createCityParts: () => new Proxy({}, { get: () => () => new sandbox.THREE.Group() }),
  CITY_BUILDING_TYPES: {
    cottage: { w:12,h:6,d:10 }, apartments:{w:16,h:14,d:12}, school:{w:24,h:9,d:18}, cafe:{w:14,h:7,d:12},
    market:{w:20,h:8,d:16}, hospital:{w:28,h:16,d:22}, offices:{w:22,h:20,d:18}, garage:{w:16,h:7,d:14},
    fire_station:{w:18,h:10,d:15}, tower:{w:20,h:36,d:20},
  },
  placeCityBuilding() {}, makeDecorativeFence() {}, placeOfficeClutter() {},
  reflect: (o) => { reflected.push(o); return o; }, microSurface: () => null,
  placeStreetClutter: (c, x, z) => { calls.services++; serviceCall.push({ x, z }); },
  placeBillboard() {}, placeParkedCar() {}, placeGunShop() {}, placeTacos() {}, placeBurgerPiz() {}, placeSixTwelve() {}, placeGasStation() {},
};
vm.createContext(sandbox);
const strip = (file) => `"use strict";\n` + fs.readFileSync(path.join(SRC,file),"utf8").replace(/export /g,"").replace(/import[\s\S]*?from\s*['"].*?['"];/g,"");
for (const f of ["spawnzones.js","neonsign.js","interiors.js","characters.js","crowd.js","merge.js","composer.js","crownstrip.js"]) {
  try { vm.runInContext(strip(f), sandbox, { filename:f }); }
  catch(e) { console.error(`load ${f}: ${e.stack || e}`); process.exit(1); }
}

let clockHours = 22;
const mockCtx = {
  scene, camera: { position:{x:0,y:0,z:0} },
  worldTime: { get hours(){return clockHours;}, isNight:()=>clockHours>=20||clockHours<6 },
  surface:()=>({material:()=>({userData:{}})}), roadMaterial:()=>({userData:{}}),
  addBlocker:(x,z,r)=>{calls.blockers++;blockers.push({x,z,r});},
  addLitSpot:(spot)=>{calls.litSpots++;litSpots.push(spot);}, addService:()=>{calls.services++;},
  addLitSpotRaw:null, placeGlbLandmark(){}, loadGLB:async()=>null,
};
const district = sandbox.createCrownStrip(mockCtx);
try { district.buildSet(); check("buildSet() runs to completion",true); }
catch(e){ check("buildSet() runs to completion",false,String(e&&e.stack||e).split("\n").slice(0,3).join(" | ")); process.exit(1); }
const CROWN_STRIP = vm.runInContext("CROWN_STRIP",sandbox);
console.log(`\n probe one patron: ${actorMeshes("makeHoodrat({seed:1})")} meshes · dancer: ${actorMeshes("makeDancer({sex:'f',seed:1})")} · hog: ${actorMeshes("makeHog({seed:1})")}`);
for(const s of district.crownService){blockers.push({x:s.x,z:s.z,r:2.2});calls.blockers++;}
const meshes=[]; const walk=(o)=>{if(o.isMesh)meshes.push(o);for(const c of o.children)walk(c);};
for(const c of scene.children)walk(c);
const crowned=meshes.filter(m=>(m.material?.name||"").startsWith("crown"));
const signs=crowned.filter(m=>m.material.name.startsWith("crown sign:"));
const signNames=new Set(signs.map(m=>m.material.name));
console.log(`\nCrown Strip build — ${CROWN_STRIP.venues.length} venues, ${crowned.length} meshes\n`);
check("every venue put a sign up",CROWN_STRIP.venues.every(v=>signNames.has(`crown sign: ${v.name}`)),`${signNames.size} distinct sign faces`);
check("the gate put its sign up",signNames.has("crown sign: CROWN STRIP"));
check("the strip built a real amount of geometry",crowned.length>300,`${crowned.length} meshes`);
const finite=m=>[m.position.x,m.position.y,m.position.z,m.rotation.x,m.rotation.y,m.rotation.z].every(Number.isFinite);
const bad=crowned.filter(m=>!finite(m));
check("no mesh has a NaN or unset transform",bad.length===0,bad.slice(0,3).map(m=>`${m.material.name}@(${m.position.x},${m.position.y},${m.position.z})`).join("|"));
check("cast/receive shadows are flags",crowned.every(m=>typeof m.castShadow==="boolean"&&typeof m.receiveShadow==="boolean"));
const byMaterial=new Map(); for(const m of crowned){const n=m.material.name.startsWith("crown sign:")?"crown sign (one per face)":m.material.name;byMaterial.set(n,(byMaterial.get(n)||0)+1);}
for(const[n,c]of[...byMaterial.entries()].sort((a,b)=>b[1]-a[1]))console.log(`         ${String(c).padStart(4)} ${n}`);
console.log(`\n         ${signs.length} unique sign meshes; ${crowned.length-signs.length} shared-material meshes`);
console.log(`\n         blockers ${calls.blockers} · occluders ${district.occluders.length} · pois ${district.pois.length} · lit spots ${calls.litSpots}`);
console.log(`         minimap buildings ${district.minimap.buildings.length}`);
check("halls are collision, not scenery",calls.blockers>300,`${calls.blockers} blockers`);
check("every venue has a camera occluder",district.occluders.length>=CROWN_STRIP.venues.length,`${district.occluders.length} occluders`);
check("every venue has a crowd POI",district.pois.length>=CROWN_STRIP.venues.length,`${district.pois.length} POIs`);
check("every venue is on the minimap",district.minimap.buildings.length>=CROWN_STRIP.venues.length,`${district.minimap.buildings.length} footprints`);
check("the strip is lit",calls.litSpots>40,`${calls.litSpots} lit spots`);
const movers=[],crowdMeshes=[];const collectMovers = o => { if(o.isMesh&&o.userData.noBatch&&(o.userData.crowd||!o.name.startsWith("static-batch")))(o.userData.crowd?crowdMeshes:movers).push(o); for(const c of o.children)collectMovers(c); };
for(const c of scene.children)collectMovers(c);
check("the cutaway's moving meshes are marked noBatch",movers.length>=CROWN_STRIP.venues.length*6,`${movers.length} meshes marked`);
check("the cutaway has one record per venue",district.crownDebug.length===CROWN_STRIP.venues.length&&CROWN_STRIP.venues.every(v=>district.crownDebug.some(d=>d.name===v.name)),district.crownDebug.map(d=>d.name).join(", "));
check("the radar has a badge per venue door",district.blips().length===CROWN_STRIP.venues.length&&district.blips().every(b=>b.kind==="casino"||b.kind==="club"),district.blips().map(b=>b.kind).join(", "));
check("interact() is a no-op away from a door",district.interact()===false);
const REQUIRED={"BAYOU GOLD":["slots","roulette","cards","cashier","bar","vault","vip"],"BILLY JEANS":["bar","pool","stage"],"DISCO GATORS":["dj","stage","bar","vip"],"HAPPY HOGS":["stage","bar"]};
const kindsOf=name=>new Set(district.crownStations.filter(s=>s.venue===name).map(s=>s.kind));
const missing=CROWN_STRIP.venues.flatMap(v=>(REQUIRED[v.name]||[]).filter(k=>!kindsOf(v.name).has(k)).map(k=>`${v.name}:${k}`));
check("every venue has the promised interaction points",missing.length===0&&Object.keys(REQUIRED).length===CROWN_STRIP.venues.length,`${district.crownStations.length} points — `+CROWN_STRIP.venues.map(v=>`${v.name}:${kindsOf(v.name).size}`).join(" "));

// ------------------------------------------------------------------ indoor walkability (flood fill)
{
  const CELL=0.5,PAD=0.45; let ok=true,why="";
  for(const v of CROWN_STRIP.venues){
    const nx=Math.ceil(v.k.w/CELL),nz=Math.ceil(v.k.d/CELL),seen=new Uint8Array(nx*nz);
    const cellX=i=>v.hall.x0+(i+0.5)*CELL,cellZ=j=>v.hall.z0+(j+0.5)*CELL;
    const blockedAt=(x,z)=>blockers.some(b=>Math.hypot(b.x-x,b.z-z)<b.r+PAD);
    const door=v.rot===0?{x:v.x,z:v.cz+v.d/2-1.2}:{x:v.x,z:v.cz-v.d/2+1.2};
    const si=Math.floor((door.x-v.hall.x0)/CELL),sj=Math.floor((door.z-v.hall.z0)/CELL);
    if(si<0||sj<0||si>=nx||sj>=nz||blockedAt(door.x,door.z)){ok=false;why=`${v.name}: doorway blocked`;break;}
    const q=[sj*nx+si];seen[q[0]]=1;
    for(let h=0;h<q.length;h++){const c=q[h],i=c%nx,j=(c-i)/nx;for(const[di,dj]of[[1,0],[-1,0],[0,1],[0,-1]]){const i2=i+di,j2=j+dj;if(i2<0||j2<0||i2>=nx||j2>=nz)continue;const c2=j2*nx+i2;if(seen[c2]||blockedAt(cellX(i2),cellZ(j2)))continue;seen[c2]=1;q.push(c2);}}
    const here=district.crownStations.filter(s=>s.venue===v.name);
    const unreachable=here.filter(s=>{for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)if(seen[j*nx+i]&&Math.hypot(cellX(i)-s.x,cellZ(j)-s.z)<=1.5)return false;return true;});
    if(unreachable.length){ok=false;why=`${v.name}: unreachable ${unreachable.map(s=>s.kind).join(",")}`;break;}
  }
  check("every game, bar, cage and stage is walkable from the door",ok,ok?"flood-filled at 0.5 m per venue":why);
}

// ------------------------------------------------------------------ light pool, mirror and service-pocket checks
{
  let ok=true,report=[];
  for(const v of CROWN_STRIP.venues){let worst=8;for(const[px,pz]of[[v.x,v.cz],[v.x-8,v.cz],[v.x+8,v.cz],[v.x,v.cz-8],[v.x,v.cz+8]]){const nearest=[...litSpots].sort((a,b)=>((a.x-px)**2+(a.z-pz)**2)-((b.x-px)**2+(b.z-pz)**2)).slice(0,8);worst=Math.min(worst,nearest.filter(s=>inCrownRect(v.hall,s.x,s.z)).length);}report.push(`${v.name}:${worst}/8`);if(worst<5)ok=false;}
  check("interior lights win the pooled-light budget",ok,report.join(" "));
  // The budget moved from 120 to 132 deliberately: a hall lit by a moving-head
  // rig needs the rig's own spot to reach the floor, and STOOGELETS/HAPPY HOGS
  // now carry two trusses each. The check above is the one that matters — that
  // the interior still wins every point in every hall, so the extra spots are
  // spent indoors and not on street spill.
  check("no dressing added excess pooled lights",calls.litSpots<=132,`${calls.litSpots} spots`);
  const matte=reflected.filter(m=>!m.material.name.startsWith("crown sign:")&&(m.material.emissive?.getHexString?.()||"000000")==="000000");
  check("only lit shapes go on the mirror layer",reflected.length>=CROWN_STRIP.venues.length*4&&matte.length===0,`${reflected.length} reflected, ${matte.length} matte`);
  let drift=null;
  for(const v of CROWN_STRIP.venues){const lx=v.service.x,lz=v.service.z,want=v.rot===0?{x:v.x+lx,z:v.cz+lz}:{x:v.x-lx,z:v.cz-lz},got=district.crownService.find(s=>s.venue===v.name);if(!got||Math.hypot(got.x-want.x,got.z-want.z)>1){drift=v.name;break;}}
  check("service pockets match venue data",!drift,drift||district.crownService.map(s=>s.venue).join(", "));
  const inHall=district.crownService.filter(s=>CROWN_STRIP.venues.some(v=>inCrownRect(v.hall,s.x,s.z)));
  check("service pockets are outside halls",inHall.length===0,`${district.crownService.length} pockets`);
}

// ------------------------------------------------------------------ camera contains the room, and the cutaway closes
{
  function rayBox(px,py,pz,dx,dy,dz,b){let tmin=0,tmax=Infinity;const axis=(p,d,lo,hi)=>{if(Math.abs(d)<1e-6)return p>=lo&&p<=hi;let t1=(lo-p)/d,t2=(hi-p)/d;if(t1>t2)[t1,t2]=[t2,t1];tmin=Math.max(tmin,t1);tmax=Math.min(tmax,t2);return tmin<=tmax;};if(!axis(px,dx,b.minX,b.maxX)||!axis(py,dy,b.minY,b.maxY)||!axis(pz,dz,b.minZ,b.maxZ))return null;return tmin>0?tmin:null;}
  let ok=true,why="";
  for(const v of CROWN_STRIP.venues){for(const[ox,oz]of[[0,0],[-v.k.w/4,0],[v.k.w/4,0],[0,-v.k.d/4],[0,v.k.d/4]]){for(let i=0;i<12;i++){const a=i/12*Math.PI*2,pitch=0.25,t=rayBox(v.x+ox,3.2,v.cz+oz,Math.cos(a)*Math.cos(pitch),Math.sin(pitch),Math.sin(a)*Math.cos(pitch),{minX:v.hall.x0,maxX:v.hall.x1,minZ:v.hall.z0,maxZ:v.hall.z1,minY:0,maxY:v.k.h});if(t!==null&&t<4){ok=false;why=`${v.name} pulls camera to ${t.toFixed(1)}m`;break;}}if(!ok)break;}if(!ok)break;}
  check("camera remains clear inside each hall",ok,why||"occluder contains all rooms");
  for(const v of CROWN_STRIP.venues){for(let i=0;i<40;i++)district.update(0.1,{x:v.x,y:0,z:v.cz});if(district.insideVenue!==v.name||district.crownDebug.find(d=>d.name===v.name).roofVisible!==false){ok=false;why=`${v.name} did not open`;break;}for(let i=0;i<40;i++)district.update(0.1,{x:v.x,y:0,z:v.cz+400});if(district.insideVenue!==null){ok=false;why=`${v.name} failed to close`;break;}}
  check("cutaway opens inside and closes after leaving",ok,why||"all 4 venues");
  const blockersDoor=blockers.find(b=>Math.hypot(b.x-CROWN_STRIP.venues[0].x,b.z-(CROWN_STRIP.venues[0].cz+CROWN_STRIP.venues[0].d/2))<2);
  check("first venue's doorway remains open",!blockersDoor,blockersDoor?`blocked at ${blockersDoor.x},${blockersDoor.z}`:"clear");
}

// ------------------------------------------------------------------ venue crowd and shared-NPC contract
{
  const crown=district.crownCrowd;
  const total=crown.reduce((n,c)=>n+c.people.length,0);
  check("scripted rooms and door crews are populated",crown.every(c=>c.people.length>=12)&&total>=60,`${total} scripted people`);
  check("ordinary pavement and crossing walkers are delegated to spawnzones/main NPCs",
    crown.every(c=>c.pavement===0&&c.walkers.length===0)&&district.crownCrossing===null,
    crown.map(c=>`${c.venue}:pave=${c.pavement}/walkers=${c.walkers.length}`).join(" "));

  const routes=crown.flatMap(c=>c.routes);
  check("car arrivals keep clear, walkable kerb routes",routes.length===CROWN_STRIP.venues.length,
    `${routes.length} kerb routes, wanted ${CROWN_STRIP.venues.length}`);
  let clash=null, road=null;
  for(const r of routes){
    const n=Math.max(2,Math.ceil(Math.hypot(r.b.x-r.a.x,r.b.z-r.a.z)/0.25));
    for(let i=0;i<=n;i++){
      const lx=r.a.x+(r.b.x-r.a.x)*i/n,lz=r.a.z+(r.b.z-r.a.z)*i/n;
      const v=CROWN_STRIP.venues.find(q=>district.crownCrowd.find(c=>c.venue===q.name).routes.includes(r));
      const p=v.rot===0?{x:v.x+lx,z:v.cz+lz}:{x:v.x-lx,z:v.cz-lz};
      if(Math.abs(p.z-CROWN_STRIP.avenue.z)<CROWN_STRIP.avenue.half-1)road=`${v.name}:${r.what} enters avenue`;
      for(const b of blockers)if(Math.hypot(b.x-p.x,b.z-p.z)<b.r+0.4)clash=`${v.name}:${r.what} intersects blocker r=${b.r}`;
    }
  }
  check("every live route is clear of furniture and carriageways",!clash&&!road,clash||road||`${routes.length} kerb-to-door spurs sampled at 0.25 m`);
}

// ------------------------------------------------------------------ batch audit: moving actors and cutaway survive
{
  const before=movers.length;
  const b=sandbox.batchStatic(scene,{exclude:()=>false,boundary:()=>false});
  check("batch sweep merges static scenery",b.removed>0,`${b.meshes} meshes, ${b.batches} batches`);
  let after=0;const recount=o=>{if(o.isMesh&&o.userData.noBatch&&!o.userData.crowd&&!o.name.startsWith("static-batch"))after++;for(const c of o.children)recount(c);};
  for(const c of scene.children)recount(c);
  check("batch sweep preserves all cutaway movers",after===before,`${before} before, ${after} after`);
  const actorMeshesAfter=district.crownCrowd.reduce((n,c)=>n+c.meshes,0)+(district.crownCrossing?district.crownCrossing.meshes:0);
  check("ordinary NPC street crowds are not duplicated into Crown batches",district.crownCrowd.every(c=>c.pavement===0&&c.walkers.length===0)&&district.crownCrossing===null,`${actorMeshesAfter} room/door actor meshes, no legacy street actors`);
  const v=CROWN_STRIP.venues[0];for(let i=0;i<40;i++)district.update(0.1,{x:v.x,y:0,z:v.cz});
  const st=district.crownDebug.find(d=>d.name===v.name);
  check("cutaway continues to open after batching",district.insideVenue===v.name&&st.roofVisible===false,`inside=${district.insideVenue}, roof=${st.roofVisible}`);
}

console.log(`\n${failures?failures+" FAILED":"all checks passed"}.\n`);
process.exit(failures?1:0);
