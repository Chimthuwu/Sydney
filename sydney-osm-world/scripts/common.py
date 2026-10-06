"""Shared helpers for the Sydney OSM world-building pipeline.

Responsibilities:
  * load config/sydney.config.json
  * resolve bounding boxes (core + tiles)
  * talk to Overpass (geometry that the MCP server does not expose)
  * write raw + normalized JSON with provenance metadata
  * the documented lat/lon -> local metres -> Three.js conversion layer

No third-party geo libraries: the maths here is small, explicit and documented.
"""

from __future__ import annotations

import json
import hashlib
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "sydney.config.json"
RAW = ROOT / "data" / "raw"
NORMALIZED = ROOT / "data" / "normalized"
WORLDDATA = ROOT / "data" / "world"
WORLD = ROOT / "world"
DOCS = ROOT / "docs"

USER_AGENT = (
    "Sydney-OSM-World/0.1 (open-world game geographic pipeline; "
    "built on the osm-mcp-server project)"
)

# Public Overpass endpoints tested from this machine (see docs/OSM-MCP.md):
#   overpass-api.de          -> reachable, full planet data      [USED]
#   overpass.osm.ch          -> reachable but a *regional* instance, returns 0 for Sydney
#   overpass.kumi.systems    -> connection timeout from this network
#   overpass.private.coffee  -> connection timeout from this network
#   overpass.osm.jp          -> TLS hostname mismatch
#   maps.mail.ru / osm.ru    -> connection timeout / refused
OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter"]


# --------------------------------------------------------------------------
# config / paths
# --------------------------------------------------------------------------
def load_config(path: Path | str = CONFIG_PATH) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def ensure_dirs() -> None:
    for directory in (RAW, NORMALIZED, WORLDDATA, WORLD, DOCS, ROOT / "data" / "cache"):
        directory.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1, sort_keys=False)
        handle.write("\n")
    return path


def read_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


# --------------------------------------------------------------------------
# bounding boxes
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class BBox:
    south: float
    west: float
    north: float
    east: float

    @property
    def overpass(self) -> str:
        # Overpass order is (south, west, north, east)
        return f"{self.south},{self.west},{self.north},{self.east}"

    def contains(self, lat: float, lon: float) -> bool:
        return self.south <= lat <= self.north and self.west <= lon <= self.east

    def as_dict(self) -> dict:
        return {
            "south": self.south,
            "west": self.west,
            "north": self.north,
            "east": self.east,
        }


def bbox_from(item: dict) -> BBox:
    return BBox(
        south=float(item["south"]),
        west=float(item["west"]),
        north=float(item["north"]),
        east=float(item["east"]),
    )


def resolve_bbox(config: dict, ref: str) -> BBox:
    """Resolve a bbox reference: 'coreBbox' or a tile id."""
    scope = config["scope"]
    if ref == "coreBbox":
        return bbox_from(scope["coreBbox"])
    for tile in scope["tiles"]:
        if tile["id"] == ref:
            return bbox_from(tile)
    raise KeyError(f"Unknown bbox reference: {ref}")


# --------------------------------------------------------------------------
# projection: WGS84 -> local ENU metres -> Three.js X/Y/Z
# --------------------------------------------------------------------------
class LocalProjection:
    """Local tangent-plane projection centred on config.origin.

    Rationale (see docs/DATA-SCHEMA.md): treating lat/lon as if they were
    Cartesian metres is wrong - one degree of longitude is ~cos(lat) times
    one degree of latitude. Over the ~6 km prototype extent an equirectangular
    tangent plane is accurate to well under 0.1%, which is far below the
    tolerance of a game world that will be compressed anyway.

    Axes (Three.js is Y-up):
        +X = east      (metres)
        +Y = up        (metres, height/terrain only)
        +Z = south     (metres)  -> north is -Z
    """

    def __init__(self, origin: dict, meters_per_unit: float = 1.0):
        self.lat0 = float(origin["lat"])
        self.lon0 = float(origin["lon"])
        self.label = origin.get("label", "origin")
        self.meters_per_unit = meters_per_unit
        # WGS84 mean-radius constants
        self.m_per_deg_lat = 111132.92 - 559.82 * math.cos(2 * self.lat0) + 1.175 * math.cos(
            4 * self.lat0
        )
        self.m_per_deg_lon = 111412.84 * math.cos(math.radians(self.lat0)) - 93.5 * math.cos(
            3 * self.lat0
        )

    def to_local(self, lat: float, lon: float) -> tuple[float, float]:
        """(lat, lon) -> (east, south) in metres."""
        east = (lon - self.lon0) * self.m_per_deg_lon
        south = -(lat - self.lat0) * self.m_per_deg_lat
        return east, south

    def to_units(self, lat: float, lon: float) -> dict:
        east, south = self.to_local(lat, lon)
        s = self.meters_per_unit
        return {
            "x": round(east / s, 3),
            "y": 0.0,
            "z": round(south / s, 3),
        }

    def to_units_polyline(self, coords: Iterable[Iterable[float]]) -> list[list[float]]:
        out = []
        for pair in coords:
            lat, lon = float(pair[0]), float(pair[1])
            east, south = self.to_local(lat, lon)
            s = self.meters_per_unit
            out.append([round(east / s, 2), 0.0, round(south / s, 2)])
        return out

    def describe(self) -> dict:
        return {
            "method": "local equirectangular tangent plane (WGS84 mean radius)",
            "origin": {
                "label": self.label,
                "lat": self.lat0,
                "lon": self.lon0,
            },
            "metersPerDegreeLatitude": round(self.m_per_deg_lat, 3),
            "metersPerDegreeLongitude": round(self.m_per_deg_lon, 3),
            "units": "meters",
            "metersPerUnit": self.meters_per_unit,
            "axes": {
                "x": "+east",
                "y": "+up (height)",
                "z": "+south (north is -Z)",
            },
            "threejs": "Geometry is emitted on the XZ plane, Y is up (height).",
        }


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    d_phi = p2 - p1
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(a))


def polyline_length_m(coords: Iterable[Iterable[float]]) -> float:
    total = 0.0
    previous = None
    for pair in coords:
        point = (float(pair[0]), float(pair[1]))
        if previous is not None:
            total += haversine_m(previous[0], previous[1], point[0], point[1])
        previous = point
    return total


def centroid(coords: Iterable[Iterable[float]]) -> tuple[float, float]:
    """Planar centroid of a lon/lat ring (adequate at city scale)."""
    points = [(float(c[0]), float(c[1])) for c in coords]
    if not points:
        raise ValueError("empty geometry")
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    return sum(lats) / len(lats), sum(lons) / len(lons)


# --------------------------------------------------------------------------
# Overpass client
# --------------------------------------------------------------------------
class OverpassClient:
    """Minimal, polite Overpass client with an on-disk response cache.

    Used *only* for the datasets the MCP server cannot return at all:
    road/water/park/building/transit/landmark **geometry** and `highway`
    features (no MCP tool queries them, and every MCP tool ends in
    `out body;`, which drops geometry). See docs/OSM-MCP.md.

    Caching matters: public Overpass mirrors rate-limit aggressively (HTTP 504),
    so every query is keyed by its SHA-256 and cached under data/cache/.
    Re-running the pipeline is then free and does not hammer the service.
    """

    def __init__(self, min_interval: float = 3.0, timeout: int = 180, cache: bool = True):
        self.min_interval = min_interval
        self.timeout = timeout
        self.use_cache = cache
        self._last_call = 0.0
        self.call_log: list[dict] = []
        self.cache_dir = ROOT / "data" / "cache" / "overpass"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _throttle(self) -> None:
        wait = self.min_interval - (time.time() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.time()

    def _cache_path(self, ql: str) -> Path:
        digest = hashlib.sha256(ql.encode("utf-8")).hexdigest()[:24]
        return self.cache_dir / f"{digest}.json"

    def _cache_read(self, ql: str) -> dict | None:
        if not self.use_cache:
            return None
        path = self._cache_path(ql)
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            return None
        self.call_log.append(
            {"label": "(cached)", "status": "cache-hit", "elements": len(payload.get("elements", []))}
        )
        return payload

    def _cache_write(self, ql: str, payload: dict) -> None:
        if not self.use_cache:
            return
        try:
            with open(self._cache_path(ql), "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
        except Exception:
            pass

    def query(self, ql: str, label: str = "", retries: int = 4) -> dict:
        """Run an Overpass QL query, returning the parsed JSON body.

        Public Overpass mirrors are flaky: 504 (gateway timeout / rate limit) and
        429 are common and are *not* query errors, so they are retried with
        backoff. A 400 is a genuine query error and fails fast.
        """
        body = urllib.parse.urlencode({"data": ql}).encode("utf-8")
        cached = self._cache_read(ql)
        if cached is not None:
            return cached
        last_error = None
        for attempt in range(1, retries + 1):
            for endpoint in OVERPASS_ENDPOINTS:
                self._throttle()
                request = urllib.request.Request(
                    endpoint,
                    data=body,
                    headers={
                        "User-Agent": USER_AGENT,
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                    },
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(request, timeout=self.timeout) as response:
                        payload = json.loads(response.read().decode("utf-8"))
                    elements = payload.get("elements", [])
                    if payload.get("remark"):
                        # Overpass ran out of its own [timeout:] and returned what it had.
                        self.call_log.append(
                            {
                                "label": label,
                                "endpoint": endpoint,
                                "status": "partial",
                                "elements": len(elements),
                                "remark": str(payload["remark"])[:300],
                            }
                        )
                    self._cache_write(ql, payload)
                    self.call_log.append(
                        {
                            "label": label,
                            "endpoint": endpoint,
                            "attempt": attempt,
                            "status": "ok",
                            "elements": len(elements),
                        }
                    )
                    return payload
                except urllib.error.HTTPError as exc:
                    detail = exc.read().decode("utf-8", "replace")[:300]
                    last_error = f"HTTP {exc.code} from {endpoint}: {detail}"
                    if exc.code == 400:  # malformed QL - retrying cannot help
                        self.call_log.append(
                            {"label": label, "endpoint": endpoint, "status": "query-error", "error": last_error}
                        )
                        raise RuntimeError(f"Overpass query '{label}' is invalid: {last_error}")
                    if exc.code in (429, 504):
                        # Public mirror is busy or has rate-limited us.
                        time.sleep(min(120, 10.0 * attempt * attempt))
                except Exception as exc:  # connection / TLS - try next endpoint
                    last_error = f"{type(exc).__name__}: {exc}"
            time.sleep(2.0 * attempt)
        self.call_log.append(
            {"label": label, "status": "error", "error": last_error, "attempts": retries}
        )
        raise RuntimeError(f"Overpass query '{label}' failed: {last_error}")

    def count(self, ql: str, label: str = "") -> dict:
        """Run a query with `out count;` to size a request before fetching it.

        Overpass returns the tally as an `elements[]` entry of type "count",
        not as a top-level `tags` object.
        """
        payload = self.query(ql, label=label or "count")
        for element in payload.get("elements", []):
            tags = element.get("tags")
            if isinstance(tags, dict) and "total" in tags:
                return tags
        return {}


# --------------------------------------------------------------------------
# Overpass QL builders
# --------------------------------------------------------------------------
def _filter_set(tag_key: str, values) -> str:
    if isinstance(values, str):
        values = [values]
    values = [str(v) for v in values]
    if not values:
        raise ValueError(f"empty value set for tag {tag_key}")
    if len(values) == 1:
        return f'["{tag_key}"="{values[0]}"]'
    joined = "|".join(values)
    return f'["{tag_key}"~"^({joined})$"]'


def _filter_any(tag_key: str) -> str:
    return f'["{tag_key}"]'


def build_selectors(
    element: str,
    tag_specs: list[dict],
    bbox: BBox,
    named_only: bool = False,
    exclude_keys: dict | None = None,
) -> list[str]:
    """Build one Overpass clause per tag spec, e.g.:

        way["leisure"~"^(park|garden)$"](bbox);
        way["landuse"~"^(forest|grass)$"](bbox);

    `tag_specs` is a list of single-key dicts exactly as written in
    config/sydney.config.json, e.g. {"highway": ["primary", "trunk"]},
    {"boundary": "national_park"} or {"building": "*"}.

    Specs are OR-ed with each other (a park is leisure=park OR landuse=forest).
    The keys *inside* one spec are AND-ed; a single-key spec has nothing to
    AND, so every spec is effectively one clause. Wrap the clauses in `( ... );`
    to have Overpass union them.
    """
    clauses: list[str] = []
    for spec in tag_specs:
        parts = []
        for tag_key, values in spec.items():
            if values is None or values == "*":
                parts.append(_filter_any(tag_key))
            else:
                parts.append(_filter_set(tag_key, values))
        selector = element + "".join(parts)
        if named_only:
            selector += '["name"]'
        for key, values in (exclude_keys or {}).items():
            selector += _filter_set(key, values)
        clauses.append(f"{selector}({bbox.overpass});")
    return clauses


def build_selector(
    element: str,
    tag_specs: list[dict],
    bbox: BBox,
    named_only: bool = False,
    exclude_keys: dict | None = None,
) -> str:
    """Single-clause convenience wrapper around build_selectors()."""
    clauses = build_selectors(element, tag_specs, bbox, named_only, exclude_keys)
    return clauses[0]


def build_query(selectors: list[str], timeout: int = 180, out: str = "body geom") -> str:
    """Assemble an Overpass QL query.

    `out` defaults to `body geom` - geometry is the whole point of this
    channel (the MCP server always uses `out body`, which drops it).
    """
    body = "\n  ".join(
        clause
        for selector in selectors
        for clause in (selector if isinstance(selector, list) else [selector])
    )
    return f"[out:json][timeout:{timeout}];\n(\n  {body}\n);\nout {out};\n"


# --------------------------------------------------------------------------
# provenance
# --------------------------------------------------------------------------
# Every record in the pipeline is tagged with where it came from, so that
# "source fact" never silently becomes "game design" (mission section 25).
LAYER_SOURCE = "source"
LAYER_DERIVED = "derived"
LAYER_AI = "ai-interpretation"
LAYER_DESIGN = "gameplay-design"


def envelope(kind: str, source_channel: str, payload: Any, extra: dict | None = None) -> dict:
    """Wrap a payload with provenance + collection metadata."""
    env = {
        "kind": kind,
        "sourceChannel": source_channel,
        "collectedAt": now_iso(),
        "dataSource": "OpenStreetMap",
        "license": "ODbL 1.0",
        "payload": payload,
    }
    if extra:
        env.update(extra)
    return env
