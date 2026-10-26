# Belize Flood Risk Explorer

An interactive web map of riverine flood hazard, exposed population, and
early-warning coverage gaps in Belize. Built from the outputs of the Belize
training notebooks (`Exercise_1_Common_Baseline_Workflow` and
`Exercise_2_Track_1_Hazard_Sensitivity`).

**Live site:** _add your GitHub Pages URL here after step 3 below._

## Layers

| Group | Layer | Encoding |
|-------|-------|----------|
| Flood hazard | 1:100-yr & 1:25-yr tiers | ordinal orange → red (nuisance → severe) |
| Exposure & EWS | Exposed population (1:100-yr) | sequential purple |
| Exposure & EWS | Early-warning coverage gap | magenta alert |
| Context | Population (WorldPop 2025) | sequential blue |
| Context | Telecom masts, national boundary | points / outline |

Source: WRI Aqueduct riverine floods, WorldPop 2025, OpenStreetMap. Basemap © CARTO.

## How it's built

- **No build step, no server.** Static HTML + [Leaflet](https://leafletjs.com) 1.9.4 (from CDN).
- Raster notebook outputs (GeoTIFF, UTM 16N) were reprojected to **Web Mercator**
  and colorized to transparent PNG overlays; vectors reprojected to WGS84 GeoJSON.
  See `tools/make_overlays.py`.
- Overlays are placed with `L.imageOverlay` (reprojected to EPSG:3857 so they
  align pixel-accurately on the Mercator basemap).

```
belize-flood-webmap/
├── index.html              # the app
├── data/
│   ├── layers.json         # layer registry: bounds, legends, metadata
│   ├── belize_boundary.geojson
│   ├── towers.geojson
│   └── overlays/*.png      # colorized raster layers
└── tools/make_overlays.py  # regenerate data/ from notebook outputs
```

## Deploy to GitHub Pages

1. Create an empty repo on GitHub (e.g. `belize-flood-webmap`), then from this folder:

   ```bash
   git remote add origin https://github.com/<you>/belize-flood-webmap.git
   git branch -M main
   git push -u origin main
   ```

2. In the repo: **Settings → Pages → Build and deployment**, set
   **Source = Deploy from a branch**, **Branch = `main` / `(root)`**, Save.

3. Wait ~1 minute. Your site goes live at
   `https://<you>.github.io/belize-flood-webmap/`. Paste it at the top of this file.

> No remote yet? Install the GitHub CLI (`gh`) and run
> `gh repo create belize-flood-webmap --public --source=. --push`, then enable Pages as above.

## Regenerate the data

After re-running the notebooks, rebuild the overlays:

```bash
python tools/make_overlays.py
```

(Requires `rasterio`, `geopandas`, `matplotlib`, `numpy`.)
