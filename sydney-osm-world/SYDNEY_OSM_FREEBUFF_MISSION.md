# Mission scope (summary)

> This is a **summary** of the brief that drove this project, written so the repository
> is self-describing. It is not a verbatim copy of the original instructions.

## Mission

Turn OpenStreetMap geographic data into a structured, AI-friendly world specification
for a future Three.js game set in a fictionalised version of Sydney, Australia.

**Do not build the game.** First build and validate the geographic-data pipeline.

The existing *Grand Theft Bayou* concept (a joke GTA-style Three.js game set in north
Louisiana) is the gameplay reference: third-person movement, vehicles, NPCs, combat,
weapons, police/security, day/night, weather, nightlife, missions, minimap, districts,
venues, ambient simulation. The **geography** changes to Sydney. Everything else stays.

## Required flow

```
REAL SYDNEY -> OPENSTREETMAP -> OSM MCP SERVER -> STRUCTURED GEOGRAPHIC DATA
            -> AI WORLD DESIGN / COMPRESSION -> FICTIONAL GTA-STYLE SYDNEY
            -> THREE.JS GAME   (later)
```

This project delivers everything up to and including the AI world-design input.

## Where each requirement landed

| Requirement | Status | Artefact |
| --- | --- | --- |
| Inspect the primary MCP repository, do not assume from its name | done | `docs/OSM-MCP.md` |
| Install and configure the MCP server locally | done | `scripts/setup.sh` |
| Determine which geographic queries it supports | done | `docs/OSM-MCP.md` |
| Test those queries against Sydney (Tests A-G) | 9/9 pass | `data/raw/test-results.json` |
| Build repeatable collection scripts | done | `scripts/query_sydney.py` |
| Normalise into clean JSON | done | `data/normalized/` |
| Produce an AI-consumable world specification | done | `data/world/world-spec.json` |
| Document everything, including failures | done | `docs/`, `data/raw/collection-log.json` |
| Use one central geographic config | done | `config/sydney.config.json` |
| Start with a manageable prototype region, not all of Sydney | done | 4 tiles, ~4.7 x 5.6 km |
| Do not download everything | done | per-tile queries, chunked amenity lists, HTTP cache |
| Prioritise roads with attributes and geometry | done | 5,793 ways, 449 km |
| Derive intersections / a road graph | done | `data/normalized/intersections.json` (derived) |
| Collect venues and preserve original tags | done | 7,157 venues, tags retained |
| Nightlife layer | done | 749 venues, 40 measured clusters |
| Parks / nature | done | 1,486 areas |
| Harbour / water / beaches | done | 121 features + derived crossings |
| Transit (spatial only) | done | 464 stops |
| Buildings - determine what OSM really provides | done | 972 sampled; heights mostly absent, not invented |
| Documented coordinate conversion layer | done | `docs/DATA-SCHEMA.md` section 4 |
| World specification | done | `data/world/world-spec.json` |
| Preserve topology, not appearance | done | `docs/WORLD-DESIGN-PROMPT.md` section 3 |
| District generation | done | 19 Voronoi districts with measured densities |
| Population / gameplay zones, kept separate from facts | done | labelled `gameplay-design` |
| Human-readable report with no made-up counts | done | `docs/SYDNEY-DATA-REPORT.md` (generated) |
| AI world-design prompt | done | `docs/WORLD-DESIGN-PROMPT.md` |
| Optional AI analysis layer | done | `data/world/world-analysis.json` |
| End-to-end repeatable workflow | done | `scripts/run_all.sh` |
| Reproducible setup, tested commands | done | `README.md` |
| Do not overengineer | done | stdlib + 2 deps, no DB/Docker/framework |
| Do not build the Three.js game yet | respected | no renderer, no NPC AI, no combat |
| Optional small visual debugger | done | `world/debug-map.html` + `scripts/verify_projection.py` |
| OSM only, no Google Maps | respected | see `ATTRIBUTION.md` |

## The honest headline

The primary MCP server works, but **it cannot supply a game world**: it has no road tool
and returns no geometry at all (every query ends in `out body;`). Three real upstream
defects had to be patched before it would run at all. The pipeline therefore uses the MCP
server for place semantics and direct Overpass for geometry — the same OSM data, split
around a documented limitation rather than around a preference.

Full detail: `docs/OSM-MCP.md`.
