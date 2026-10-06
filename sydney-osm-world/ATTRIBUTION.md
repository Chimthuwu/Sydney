# Attribution

## Data source

All geographic data in this project comes from **OpenStreetMap**.

> **&copy; OpenStreetMap contributors**
> Data &copy; OpenStreetMap contributors, available under the
> [Open Database License (ODbL)](https://www.openstreetmap.org/copyright).

- Project: <https://www.openstreetmap.org/>
- Copyright page and licence text: <https://www.openstreetmap.org/copyright>
- Licence: Open Database License v1.0 (ODbL 1.0)

## What was queried

| Service | Endpoint | Used for |
| --- | --- | --- |
| Overpass API | `https://overpass-api.de/api/interpreter` | roads, buildings, water, parks, transit, landmarks, venue geometry |
| Nominatim | `https://nominatim.openstreetmap.org` | geocoding and reverse geocoding (via the MCP server) |
| OSRM | `https://router.project-osrm.org` | corridor routing distances (via the MCP server) |

All three are free public services operated by the OpenStreetMap Foundation and its
community. None required an API key. None of their data is redistributed by them under
anything other than ODbL.

## Attribution requirements

The ODbL requires that any derived database be attributed and that the licence travel with
the data. If you ship this dataset - or any part of it - inside a game, a public website,
a design document or a generated world, you must:

1. **Credit OpenStreetMap** visibly, with the "© OpenStreetMap contributors" attribution.
2. **Link to the licence**: <https://www.openstreetmap.org/copyright>
3. **State the ODbL** applies to the data.
4. **Keep the licence notice** with any copy of the data you distribute.

A suitable in-game or in-product notice:

```
Geographic data derived from OpenStreetMap.
© OpenStreetMap contributors, licensed under the Open Database License (ODbL) 1.0.
https://www.openstreetmap.org/copyright
```

Suggested placement for a game: a credits screen, an "Attributions" menu entry, or a
`LICENSES.md` / third-party notices file shipped alongside the build.

### Share-alike

ODbL is a **share-alike** licence. A *derived database* built from OSM data must itself be
released under ODbL. In practice this applies if you distribute the geographic data itself
(for example, publishing the generated world geometry as a dataset). Purely internal use
by a game does not trigger a share-alike obligation on the game's art and code, but any
geographic dataset you publish must carry the ODbL.

**This matters for the fictionalisation plan.** The world *spec* is a derived database and
stays ODbL. The *fictional city you design from it* is your own work, provided you do not
reproduce OSM data verbatim. Fictional names, fictional buildings and compressed layouts
are yours; shipping OSM geometry and calling it a game world is not.

## What is NOT in this project

- **No Google Maps data, tiles, imagery, place database or API output.** None was used,
  scraped, cached or vendored. The brief explicitly ruled this out and the rule was kept.
- **No proprietary map assets of any kind.** No satellite imagery, no vector tiles from a
  commercial provider, no turn-by-turn datasets.
- **No OSM raster tiles.** The MCP server exposes a tile resource, but this pipeline never
  calls it; nothing here depends on rendering OSM's own map images.
- **No real-world business data** beyond the names and tags that are themselves part of
  OpenStreetMap's open data.

## Code

The MCP server vendored in `open-streetmap-mcp/` is a third-party project by
Jagan Shanmugam, distributed under its own licence. See `open-streetmap-mcp/LICENSE`
and <https://github.com/jagan-shanmugam/open-streetmap-mcp>. A small patch is applied
to it in this project; see `patches/` and `docs/OSM-MCP.md`.

The pipeline scripts in `scripts/` were written for this project.
