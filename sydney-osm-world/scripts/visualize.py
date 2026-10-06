"""Generate a tiny, dependency-free debug map of the collected data.

This exists to answer one question: *does the data actually look like the
Sydney area we asked for?* It is not a game renderer and is not meant to be
pretty. No build step, no npm, no Three.js - one HTML file with canvas 2D.

    roads      = lines (arterials thick, local thin)
    water      = filled polygons
    parks      = filled polygons
    buildings  = outlines
    venues     = dots (nightlife highlighted)
    transit    = markers
    landmarks  = crosses

Run:  python scripts/visualize.py
Writes: world/debug-map.html
"""

from __future__ import annotations

import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    NORMALIZED,
    WORLD,
    WORLDDATA,
    LocalProjection,
    ensure_dirs,
    load_config,
    now_iso,
    read_json,
    write_json,
)


def main() -> int:
    ensure_dirs()
    config = load_config()
    projection = LocalProjection(config["origin"], config["projection"].get("metersPerUnit", 1.0))
    spec = read_json(WORLDDATA / "world-spec.json")
    roads_all = read_json(NORMALIZED / "roads.json")["payload"]["roads"]
    water = read_json(NORMALIZED / "waterways.json")["payload"]["water"]
    parks = read_json(NORMALIZED / "parks.json")["payload"]["parks"]
    buildings = read_json(NORMALIZED / "buildings.json")["payload"]["buildings"]
    venues = read_json(NORMALIZED / "venues.json")["payload"]["venues"]
    transit = read_json(NORMALIZED / "transit.json")["payload"]["transit"]
    landmarks = read_json(NORMALIZED / "landmarks.json")["payload"]["landmarks"]

    payload = {
        "generatedAt": now_iso(),
        "roads": [
            {
                "p": road["geometryLocal"],
                "c": road["category"],
                "n": road["name"],
                "b": road["bridge"],
                "t": road["tunnel"],
            }
            for road in roads_all
        ],
        "water": [
            {
                "outer": [projection.to_units_polyline(ring) for ring in record["rings"]["outer"]],
                "inner": [projection.to_units_polyline(ring) for ring in record["rings"].get("inner", [])],
                "n": record["name"],
                "k": record["kind"],
            }
            for record in water
            if record.get("rings", {}).get("outer")
        ],
        "parks": [
            {
                "outer": [projection.to_units_polyline(ring) for ring in record["rings"]["outer"]],
                "n": record["name"],
            }
            for record in parks
            if record.get("rings", {}).get("outer")
        ],
        "buildings": [
            {"p": [[p[0], p[2]] for p in record["footprintLocal"]], "n": record["name"]}
            for record in buildings[:4000]
        ],
        "venues": [
            {
                "x": record["local"]["x"],
                "y": record["local"]["z"],
                "n": record["name"],
                "g": record["group"],
                "nl": record["isNightlife"],
            }
            for record in venues
            if record["local"]
        ],
        "transit": [
            {"x": record["local"]["x"], "y": record["local"]["z"], "n": record["name"], "k": record["kind"]}
            for record in transit
            if record["local"]
        ],
        "landmarks": [
            {"x": record["local"]["x"], "y": record["local"]["z"], "n": record["name"]}
            for record in landmarks
            if record["local"] and record["name"]
        ],
        "districts": [
            {"id": d["id"], "name": d["realName"], "x": d["local"]["x"], "y": d["local"]["z"]}
            for d in spec["districts"]
        ],
    }
    write_json(WORLD / "debug-data.json", payload)

    html_doc = TEMPLATE.replace("__DATA__", json.dumps(payload, separators=(",", ":"))).replace(
        "__GENERATED__", now_iso()
    )
    (WORLD / "debug-map.html").write_text(html_doc, encoding="utf-8")
    print(f"written: {WORLD / 'debug-map.html'}")
    print(f"         {WORLD / 'debug-data.json'}")

    # Static SVG renders: no JavaScript, no browser quirks, opens anywhere.
    full_bounds = _bounds(payload)
    (WORLD / "preview.svg").write_text(_svg(payload, full_bounds, 1600, 1000, "Sydney OSM world spec", config), encoding="utf-8")
    cbd = next(t for t in config["scope"]["tiles"] if t["id"] == "cbd")
    corners = [
        projection.to_local(cbd["south"], cbd["west"]),
        projection.to_local(cbd["north"], cbd["east"]),
    ]
    inset = {
        "min_x": min(c[0] for c in corners) - 60,
        "max_x": max(c[0] for c in corners) + 60,
        "min_z": min(c[1] for c in corners) - 60,
        "max_z": max(c[1] for c in corners) + 60,
    }
    (WORLD / "preview-cbd.svg").write_text(
        _svg(payload, inset, 1600, 1000, "Sydney CBD - zoomed", config), encoding="utf-8"
    )
    print(f"         {WORLD / 'preview.svg'}")
    print(f"         {WORLD / 'preview-cbd.svg'}")
    print("open any of these directly - no server, no build step")
    return 0


def _bounds(payload: dict) -> dict:
    xs, zs = [], []
    for road in payload["roads"]:
        for point in road["p"]:
            xs.append(point[0])
            zs.append(point[2])
    for group in ("venues", "transit", "landmarks"):
        for item in payload[group]:
            xs.append(item["x"])
            zs.append(item["y"])
    for district in payload["districts"]:
        xs.append(district["x"])
        zs.append(district["y"])
    pad = 60
    return {
        "min_x": min(xs) - pad, "max_x": max(xs) + pad,
        "min_z": min(zs) - pad, "max_z": max(zs) + pad,
    }


def _svg(payload: dict, bounds: dict, width: int, height: int, title: str, config: dict) -> str:
    """Render the payload as a standalone SVG. North is up."""
    panel = 150
    map_w, map_h = width - panel - 20, height - 46
    span_x = max(bounds["max_x"] - bounds["min_x"], 1.0)
    span_z = max(bounds["max_z"] - bounds["min_z"], 1.0)
    scale = min(map_w / span_x, map_h / span_z)
    off_x = 10 + (map_w - span_x * scale) / 2
    off_y = 36 + (map_h - span_z * scale) / 2

    def px(x: float) -> float:
        return off_x + (x - bounds["min_x"]) * scale

    def py(z: float) -> float:
        # flip: north (negative z) must be up
        return off_y + (z - bounds["min_z"]) * scale

    def in_view(x: float, z: float) -> bool:
        return bounds["min_x"] - 200 <= x <= bounds["max_x"] + 200 and bounds["min_z"] - 200 <= z <= bounds["max_z"] + 200

    def path_of(points, close: bool) -> str:
        parts = []
        for point in points:
            x, z = point[0], point[1]
            if not in_view(x, z):
                parts = []
                break
            parts.append(f"{'M' if not parts else 'L'}{px(x):.1f},{py(z):.1f}")
        if parts and close:
            parts.append("Z")
        return "".join(parts)

    out: list[str] = []
    add = out.append
    add(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="ui-monospace,Menlo,Consolas,monospace">'
    )
    add(f'<rect width="{width}" height="{height}" fill="#0d1117"/>')
    add(f'<text x="12" y="22" fill="#e6edf3" font-size="15">{title}</text>')
    add(
        f'<text x="{width - panel}" y="22" fill="#8b949e" font-size="10" text-anchor="end">'
        f'{payload["generatedAt"][:19].replace("T", " ")} UTC &#183; OpenStreetMap ODbL</text>'
    )
    add(f'<clipPath id="clip"><rect x="10" y="36" width="{map_w}" height="{map_h}"/></clipPath>')
    add('<g clip-path="url(#clip)">')

    # water
    add('<g fill="#12395c" stroke="#1f6feb" stroke-width="0.6">')
    for water in payload["water"]:
        for ring in water.get("outer", []):
            d = path_of([[p[0], p[2]] for p in ring], True)
            if d:
                add(f'<path d="{d}"/>')
    add("</g>")
    # water labels
    add('<g fill="#58a6ff" font-size="9" text-anchor="middle">')
    for water in payload["water"]:
        if not water.get("n") or water["k"] not in ("water_body", "bay"):
            continue
        for ring in water.get("outer", []):
            if len(ring) < 40:
                continue
            xs = [p[0] for p in ring]
            zs = [p[2] for p in ring]
            cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
            if in_view(cx, cz):
                add(f'<text x="{px(cx):.1f}" y="{py(cz):.1f}" opacity="0.85">{html.escape(water["n"][:26])}</text>')
            break
    add("</g>")

    # parks
    add('<g fill="#1c3f26" stroke="#2ea043" stroke-width="0.5">')
    for park in payload["parks"]:
        for ring in park.get("outer", []):
            d = path_of([[p[0], p[2]] for p in ring], True)
            if d:
                add(f'<path d="{d}"/>')
    add("</g>")

    # buildings
    add('<g fill="none" stroke="#3d444d" stroke-width="0.4">')
    for building in payload["buildings"]:
        d = path_of(building["p"], True)
        if d:
            add(f'<path d="{d}"/>')
    add("</g>")

    # local streets
    add('<g fill="none" stroke="#252b33" stroke-width="0.55">')
    for road in payload["roads"]:
        if road["c"] not in ("local", "service", "pedestrian"):
            continue
        d = path_of([[p[0], p[2]] for p in road["p"]], False)
        if d:
            add(f'<path d="{d}"/>')
    add("</g>")

    # arterials, casings then fill
    arterial = [r for r in payload["roads"] if r["c"] not in ("local", "service", "pedestrian")]
    add('<g fill="none" stroke="#1c2128" stroke-width="2.4" stroke-linecap="round">')
    for road in arterial:
        d = path_of([[p[0], p[2]] for p in road["p"]], False)
        if d:
            add(f'<path d="{d}"/>')
    add("</g>")
    add('<g fill="none" stroke="#6e7681" stroke-width="1.1" stroke-linecap="round">')
    for road in arterial:
        d = path_of([[p[0], p[2]] for p in road["p"]], False)
        if d:
            add(f'<path d="{d}"/>')
    add("</g>")
    # bridges / tunnels highlighted
    add('<g fill="none" stroke="#f0b429" stroke-width="1.8">')
    for road in payload["roads"]:
        if not (road["b"] or road["t"]):
            continue
        d = path_of([[p[0], p[2]] for p in road["p"]], False)
        if d:
            add(f'<path d="{d}"/>')
    add("</g>")

    # venues
    add('<g fill="#d29922" opacity="0.75">')
    for venue in payload["venues"]:
        if venue["nl"] or not in_view(venue["x"], venue["y"]):
            continue
        add(f'<circle cx="{px(venue["x"]):.1f}" cy="{py(venue["y"]):.1f}" r="1.5"/>')
    add("</g>")
    add('<g fill="#f85149">')
    for venue in payload["venues"]:
        if not venue["nl"] or not in_view(venue["x"], venue["y"]):
            continue
        add(f'<circle cx="{px(venue["x"]):.1f}" cy="{py(venue["y"]):.1f}" r="2.6"/>')
    add("</g>")

    # transit
    add('<g fill="none" stroke="#a371f7" stroke-width="1.6">')
    for stop in payload["transit"]:
        if not in_view(stop["x"], stop["y"]):
            continue
        x, y = px(stop["x"]), py(stop["y"])
        add(f'<path d="M{x - 3.5:.1f},{y - 3.5:.1f}h7v7h-7z"/>')
    add("</g>")

    # named landmarks
    add('<g stroke="#39c5cf" stroke-width="1.3">')
    for landmark in payload["landmarks"]:
        if not in_view(landmark["x"], landmark["y"]):
            continue
        x, y = px(landmark["x"]), py(landmark["y"])
        add(f'<path d="M{x - 3:.1f},{y - 3:.1f}l6,6M{x + 3:.1f},{y - 3:.1f}l-6,6"/>')
    add("</g>")

    # district labels
    add('<g text-anchor="middle" font-size="10">')
    for district in payload["districts"]:
        if not in_view(district["x"], district["y"]):
            continue
        x, y = px(district["x"]), py(district["y"])
        add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" fill="none" stroke="#e6edf3" stroke-width="1"/>')
        add(
            f'<text x="{x:.1f}" y="{y - 7:.1f}" fill="#e6edf3" stroke="#0d1117" stroke-width="2.5" '
            f'paint-order="stroke">{html.escape(district["name"])}</text>'
        )
    add("</g>")
    add("</g>")  # clip

    # scale bar + legend
    bar_m = 1000
    bar_px = bar_m * scale
    bx, by = 20, height - 18
    add(f'<g><line x1="{bx}" y1="{by}" x2="{bx + bar_px:.1f}" y2="{by}" stroke="#e6edf3" stroke-width="2"/>')
    add(f'<line x1="{bx}" y1="{by - 4}" x2="{bx}" y2="{by + 4}" stroke="#e6edf3" stroke-width="2"/>')
    add(f'<line x1="{bx + bar_px:.1f}" y1="{by - 4}" x2="{bx + bar_px:.1f}" y2="{by + 4}" stroke="#e6edf3" stroke-width="2"/>')
    add(f'<text x="{bx + bar_px + 8:.1f}" y="{by + 4:.1f}" fill="#c9d1d9" font-size="11">1 km</text>')
    add("</g>")
    add('<text x="20" y="34" fill="#6e7681" font-size="10">north is up &#183; local ENU metres &#183; origin: '
        f'{config["origin"]["lat"]}, {config["origin"]["lon"]}</text>')

    lx = width - panel + 6
    ly = 52
    legend = [
        ("#6e7681", "arterial road"),
        ("#252b33", "local / service street"),
        ("#f0b429", "bridge or tunnel"),
        ("#12395c", "water"),
        ("#1c3f26", "park / green"),
        ("#3d444d", "building outline"),
        ("#d29922", "venue"),
        ("#f85149", "nightlife venue"),
        ("#a371f7", "transit stop"),
        ("#39c5cf", "named landmark"),
    ]
    add(f'<rect x="{width - panel - 6}" y="42" width="{panel - 6}" height="{len(legend) * 20 + 66}" fill="#161b22" stroke="#30363d"/>')
    add(f'<text x="{lx}" y="{ly}" fill="#e6edf3" font-size="11">legend</text>')
    for i, (color, label) in enumerate(legend):
        y = ly + 20 + i * 20
        add(f'<rect x="{lx}" y="{y - 9}" width="11" height="11" fill="{color}" stroke="#30363d"/>')
        add(f'<text x="{lx + 18}" y="{y}" fill="#c9d1d9" font-size="11">{label}</text>')
    counts = [
        ("roads", len(payload["roads"])),
        ("water", len(payload["water"])),
        ("parks", len(payload["parks"])),
        ("buildings", len(payload["buildings"])),
        ("venues", len(payload["venues"])),
        ("nightlife", sum(1 for v in payload["venues"] if v["nl"])),
        ("transit", len(payload["transit"])),
    ]
    cy = ly + 26 + len(legend) * 20
    for label, value in counts:
        add(f'<text x="{lx}" y="{cy}" fill="#8b949e" font-size="11">{label}</text>')
        add(f'<text x="{width - 14}" y="{cy}" fill="#c9d1d9" font-size="11" text-anchor="end">{value}</text>')
        cy += 18
    add("</svg>")
    return "".join(out)


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sydney OSM debug map</title>
<style>
  body { margin:0; background:#0d1117; color:#c9d1d9; font:13px/1.5 ui-monospace,Menlo,Consolas,monospace; }
  #wrap { display:flex; height:100vh; }
  canvas { flex:1; background:#0d1117; }
  #side { width:290px; padding:14px; overflow:auto; border-left:1px solid #21262d; }
  h1 { font-size:14px; margin:0 0 4px; }
  .sub { color:#8b949e; font-size:11px; margin-bottom:12px; }
  label { display:block; margin:6px 0; cursor:pointer; }
  .k { display:inline-block; width:10px; height:10px; margin-right:7px; vertical-align:-1px; }
  table { width:100%; border-collapse:collapse; font-size:11px; margin-top:10px; }
  td { padding:2px 0; border-bottom:1px solid #161b22; }
  td:last-child { text-align:right; color:#8b949e; }
  #hover { margin-top:12px; color:#f0b429; font-size:11px; min-height:30px; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="c"></canvas>
  <div id="side">
    <h1>Sydney OSM debug map</h1>
    <div class="sub">generated __GENERATED__<br>projection: local ENU metres, x=east, z=south</div>
    <label><span class="k" style="background:#8b949e"></span>arterial roads</label>
    <label><span class="k" style="background:#484f58"></span>local / service streets</label>
    <label><span class="k" style="background:#1f6feb"></span>water</label>
    <label><span class="k" style="background:#238636"></span>parks</label>
    <label><span class="k" style="background:#6e7681"></span>buildings</label>
    <label><span class="k" style="background:#d29922"></span>venues</label>
    <label><span class="k" style="background:#f85149"></span>nightlife venues</label>
    <label><span class="k" style="background:#a371f7"></span>transit stops</label>
    <label><span class="k" style="background:#39c5cf"></span>named landmarks</label>
    <label><input type="checkbox" id="showNames" checked> district labels</label>
    <div id="hover"></div>
    <table id="counts"></table>
  </div>
</div>
<script>
const DATA = __DATA__;
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
const hover = document.getElementById('hover');

let bounds = {minX:1e9,maxX:-1e9,minZ:1e9,maxZ:-1e9};
function grow(x,z){ if(x<bounds.minX)bounds.minX=x; if(x>bounds.maxX)bounds.maxX=x;
                    if(z<bounds.minZ)bounds.minZ=z; if(z>bounds.maxZ)bounds.maxZ=z; }
DATA.roads.forEach(r=>r.p.forEach(p=>grow(p[0],p[2])));
DATA.venues.forEach(v=>grow(v.x,v.y));
DATA.transit.forEach(v=>grow(v.x,v.y));
DATA.landmarks.forEach(v=>grow(v.x,v.y));
DATA.districts.forEach(d=>grow(d.x,d.y));

let view = {s:1, ox:0, oy:0}, drag = null;
function resize(){
  const dpr = window.devicePixelRatio||1;
  canvas.width = canvas.clientWidth*dpr; canvas.height = canvas.clientHeight*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  fit();
}
function fit(){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const pad = 24;
  const sx = (w-pad*2)/(bounds.maxX-bounds.minX), sz = (h-pad*2)/(bounds.maxZ-bounds.minZ);
  view.s = Math.min(sx,sz);
  view.ox = pad - bounds.minX*view.s + (w-pad*2 - (bounds.maxX-bounds.minX)*view.s)/2;
  view.oy = pad - bounds.minZ*view.s + (h-pad*2 - (bounds.maxZ-bounds.minZ)*view.s)/2;
  draw();
}
const X = x => view.ox + x*view.s;
const Y = z => view.oy + z*view.s;

function poly(pts, close){
  ctx.beginPath();
  for(let i=0;i<pts.length;i++){ const p=X(pts[i][0]), q=Y(pts[i][2]||pts[i][1]); i?ctx.lineTo(p,q):ctx.moveTo(p,q); }
  if(close) ctx.closePath();
}
function localRoads(){ ctx.lineWidth=1; ctx.strokeStyle='#2a3038'; ctx.beginPath();
  for(const r of DATA.roads){ if(r.c!=='local'&&r.c!=='service'&&r.c!=='pedestrian') continue;
    for(let i=0;i<r.p.length;i++){ const p=X(r.p[i][0]),q=Y(r.p[i][2]); i?ctx.lineTo(p,q):ctx.moveTo(p,q);} }
  ctx.stroke(); }
function arterialRoads(){ for(const pass of [1,2]){ ctx.lineWidth = pass===1?3.2:1.2;
    ctx.strokeStyle = pass===1?'#2d333b':'#8b949e'; ctx.beginPath();
    for(const r of DATA.roads){ if(r.c==='local'||r.c==='service'||r.c==='pedestrian') continue;
      for(let i=0;i<r.p.length;i++){ const p=X(r.p[i][0]),q=Y(r.p[i][2]); i?ctx.lineTo(p,q):ctx.moveTo(p,q);} }
    ctx.stroke(); } }
function areas(list, color){ ctx.fillStyle=color;
  for(const a of list){
    for(const ring of (a.outer||[])){ if(ring.length<3) continue; ctx.beginPath(); poly(ring,true); ctx.fill(); }
  } }
function dots(list, color, r, nightlife){
  ctx.fillStyle=color;
  for(const v of list){ if(nightlife && !v.nl) continue;
    const p=X(v.x), q=Y(v.y); ctx.beginPath(); ctx.arc(p,q,r,0,6.2832); ctx.fill(); } }
function crosses(list){ ctx.strokeStyle='#39c5cf'; ctx.lineWidth=1.4; ctx.beginPath();
  for(const v of list){ const p=X(v.x),q=Y(v.y); ctx.moveTo(p-4,q-4); ctx.lineTo(p+4,q+4); ctx.moveTo(p+4,q-4); ctx.lineTo(p-4,q+4);} ctx.stroke(); }

function draw(){
  const w=canvas.clientWidth, h=canvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  areas(DATA.water,'#1f6feb');
  areas(DATA.parks,'#238636');
  ctx.strokeStyle='#3d444d'; ctx.lineWidth=1; ctx.beginPath();
  for(const b of DATA.buildings){ if(!b.p||b.p.length<3) continue; poly(b.p,true); ctx.moveTo(X(b.p[0][0]),Y(b.p[0][2])); }
  ctx.stroke();
  localRoads(); arterialRoads();
  dots(DATA.venues,'#d29922',1.6,false);
  dots(DATA.venues,'#f85149',2.6,true);
  dots(DATA.transit,'#a371f7',2.6,false);
  crosses(DATA.landmarks);
  if(document.getElementById('showNames').checked){
    ctx.fillStyle='#e6edf3'; ctx.font='12px ui-monospace,monospace'; ctx.textAlign='center';
    for(const d of DATA.districts){ const p=X(d.x),q=Y(d.y);
      ctx.strokeStyle='rgba(230,237,243,.35)'; ctx.beginPath(); ctx.arc(p,q,4,0,6.2832); ctx.stroke();
      ctx.fillText(d.name,p,q-8); }
  }
  document.getElementById('counts').innerHTML = [
    ['roads', DATA.roads.length], ['water polys', DATA.water.length], ['parks', DATA.parks.length],
    ['buildings', DATA.buildings.length], ['venues', DATA.venues.length],
    ['nightlife', DATA.venues.filter(v=>v.nl).length], ['transit', DATA.transit.length],
    ['landmarks', DATA.landmarks.length], ['districts', DATA.districts.length]
  ].map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

canvas.addEventListener('mousemove', e=>{
  const mx=e.offsetX, my=e.offsetY; let best=null, bd=14;
  for(const v of DATA.landmarks.concat(DATA.transit)){
    const dx=X(v.x)-mx, dy=Y(v.y)-my, d=Math.hypot(dx,dy);
    if(d<bd){bd=d;best=v;}
  }
  if(best){ hover.textContent = best.n + (best.k? ' ['+best.k+']':'');
    ctx.strokeStyle='#f0b429'; ctx.beginPath(); ctx.arc(X(best.x),Y(best.y),8,0,6.2832); ctx.stroke(); }
  else hover.textContent='';
});
canvas.addEventListener('wheel', e=>{ e.preventDefault();
  const f = e.deltaY<0?1.15:1/1.15;
  view.s*=f;
  const mx=e.offsetX, my=e.offsetY;
  view.ox = mx - (mx-view.ox)*f; view.oy = my - (my-view.oy)*f;
  draw(); }, {passive:false});
let down=null;
canvas.addEventListener('mousedown', e=>down={x:e.offsetX,y:e.offsetY,ox:view.ox,oy:view.oy});
window.addEventListener('mouseup',()=>down=null);
canvas.addEventListener('mousemove', e=>{ if(!down) return;
  view.ox = down.ox + (e.offsetX-down.x); view.oy = down.oy + (e.offsetY-down.y); draw(); });
document.getElementById('showNames').addEventListener('change', draw);
window.addEventListener('resize', resize);
resize();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    raise SystemExit(main())
