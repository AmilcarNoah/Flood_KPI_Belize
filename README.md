# Belize Flood Story

An interactive 3D scrollytelling map of riverine flood hazard, population
exposure, and early-warning (telecom) coverage in Belize. Built from the outputs
of the Belize training notebooks (`Exercise_1_Common_Baseline_Workflow` and
`Exercise_2_Track_1_Hazard_Sensitivity`).

**Live site:** https://amilcarnoah.github.io/Flood_KPI_Belize/

## How it works

The page is a fixed MapLibre GL map with a deck.gl overlay, driven by a
scroll-based narrative. Each chapter flies the camera and swaps the active data
layer. Dark / Light / Satellite basemaps can be switched at any time.

## Layers

| Group | Layer | Encoding |
|-------|-------|----------|
| Context | Population (WorldPop 2025) | 3D peaks, teal → yellow → white by density |
| Hazard | Flood extent (WRI Aqueduct) | vectorized glowing blue polygons, graded by depth class |
| Exposure | Flooded population | denser 3D peaks over the flooded area |
| Coverage | Telecom masts, 5 km buffers | animated "ping" pulses + dissolved coverage |
| Context | National boundary | used to frame the map to the full country extent |

## Tech

MapLibre GL JS + deck.gl (ColumnLayer peaks, ScatterplotLayer pings, GeoJson
layers), vanilla HTML/CSS/JS, deployed on GitHub Pages.

- `index.html` — page shell and library includes
- `css/styles.css` — theme tokens and scrollytelling layout
- `js/app.js` — map, layers, chapters, animation
- `data/` — prebuilt JSON/GeoJSON (population points, flood vectors, masts,
  coverage, boundary, story metadata)

## Data preparation

The `data/` files are generated from the notebook rasters by the Python tools
(`make_story_data.py`, `flood_vectorize.py`), which require `rasterio`,
`geopandas`, `shapely`, `matplotlib`, and `numpy`.

Sources: WRI Aqueduct riverine floods, WorldPop 2025, OpenStreetMap (telecom
towers). Basemaps: OpenFreeMap (dark/light vector tiles), Esri World Imagery
(satellite).
