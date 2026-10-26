import os, json, numpy as np
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling, transform_bounds
import matplotlib
import matplotlib.image as mpimg
from matplotlib.colors import LinearSegmentedColormap, Normalize, PowerNorm
import geopandas as gpd

# Paths: site dir is derived from this script's location (tools/ -> repo root);
# OUT/DATA default to the sibling training folders and can be overridden via env vars.
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TRAIN = os.path.dirname(os.path.dirname(SITE))  # ...\Training\Training
OUT = os.environ.get("NB_OUTPUT_DIR", os.path.join(os.path.dirname(SITE), "output"))
DATA = os.environ.get("NB_DATA_DIR", os.path.join(_TRAIN, "Data"))
OVER = os.path.join(SITE, "data", "overlays")
DDIR = os.path.join(SITE, "data")
os.makedirs(OVER, exist_ok=True)

def reproject_to_4326(path):
    # Reproject to Web Mercator (3857) so a Leaflet imageOverlay — which places
    # the image linearly in Mercator screen space — aligns pixel-accurately.
    with rasterio.open(path) as src:
        dst_crs = "EPSG:3857"
        transform, w, h = calculate_default_transform(
            src.crs, dst_crs, src.width, src.height, *src.bounds)
        data = np.full((h, w), np.nan, dtype="float32")
        reproject(
            source=rasterio.band(src, 1),
            destination=data,
            src_transform=src.transform, src_crs=src.crs,
            dst_transform=transform, dst_crs=dst_crs,
            resampling=Resampling.nearest,
            src_nodata=src.nodata, dst_nodata=np.nan)
        # convert the 3857 array extent to lat/lng for Leaflet bounds
        b = transform_bounds(dst_crs, "EPSG:4326", *rasterio.transform.array_bounds(h, w, transform))
    # leaflet bounds [[south, west],[north, east]]
    west, south, east, north = b
    return data, [[south, west], [north, east]]

def to_rgba_png(data, cmap, norm, outpath, mask_extra=None):
    arr = data.astype("float32")
    valid = np.isfinite(arr)
    if mask_extra is not None:
        valid &= mask_extra(arr)
    rgba = np.zeros((arr.shape[0], arr.shape[1], 4), dtype="uint8")
    if valid.any():
        normed = norm(np.ma.masked_array(arr, ~valid))
        colors = cmap(normed)  # float 0-1 RGBA
        rgba[..., :3] = (colors[..., :3] * 255).astype("uint8")
        rgba[..., 3] = np.where(valid, 230, 0).astype("uint8")
    mpimg.imsave(outpath, rgba)

# ---- colormaps (sequential single-hue; CVD-safe ordered ramps) ----
blues = LinearSegmentedColormap.from_list("pop", ["#deebf7", "#6baed6", "#2171b5", "#08306b"])
purples = LinearSegmentedColormap.from_list("exp", ["#efedf5", "#9e9ac8", "#6a51a3", "#3f007d"])
# ordinal hazard: nuisance -> severe
hazard = LinearSegmentedColormap.from_list("haz", ["#fdae6b", "#d7301f"])
gapcmap = LinearSegmentedColormap.from_list("gap", ["#f768a1", "#7a0177"])

layers = []

# 1. Population density
d, bnds = reproject_to_4326(os.path.join(OUT, "worldpop_belize_utm16n_100m.tif"))
vmax = np.nanpercentile(d[d > 0], 97) if np.isfinite(d).any() else 1
to_rgba_png(d, blues, PowerNorm(0.5, vmin=0, vmax=vmax), os.path.join(OVER, "population.png"),
            mask_extra=lambda a: a > 0)
layers.append({"id": "population", "name": "Population (WorldPop 2025)",
               "file": "data/overlays/population.png", "bounds": bnds, "group": "context",
               "legend": {"type": "gradient", "colors": ["#deebf7", "#08306b"],
                          "labels": ["low", f"≥{vmax:.0f} ppl / 100 m cell"]},
               "about": "Modelled 2025 residential population, 100 m grid. ~342,870 people nationally."})

# 2. Flood hazard 100-yr (tiers)
d, bnds = reproject_to_4326(os.path.join(OUT, "hazard_tiers_100yr.tif"))
to_rgba_png(d, hazard, Normalize(1, 2), os.path.join(OVER, "hazard_100yr.png"),
            mask_extra=lambda a: a >= 1)
layers.append({"id": "hazard_100yr", "name": "Flood hazard — 1:100-yr", "default": True,
               "file": "data/overlays/hazard_100yr.png", "bounds": bnds, "group": "hazard",
               "legend": {"type": "categorical",
                          "items": [{"color": "#fdae6b", "label": "Tier 1 · nuisance (0.15–0.5 m)"},
                                    {"color": "#d7301f", "label": "Tier 2 · severe (≥ 0.5 m)"}]},
               "about": "WRI Aqueduct riverine inundation, 100-yr return period, depth ≥ 0.15 m."})

# 3. Flood hazard 25-yr (tiers)
d, bnds = reproject_to_4326(os.path.join(OUT, "hazard_tiers_025yr.tif"))
to_rgba_png(d, hazard, Normalize(1, 2), os.path.join(OVER, "hazard_025yr.png"),
            mask_extra=lambda a: a >= 1)
layers.append({"id": "hazard_025yr", "name": "Flood hazard — 1:25-yr",
               "file": "data/overlays/hazard_025yr.png", "bounds": bnds, "group": "hazard",
               "legend": {"type": "categorical",
                          "items": [{"color": "#fdae6b", "label": "Tier 1 · nuisance (0.15–0.5 m)"},
                                    {"color": "#d7301f", "label": "Tier 2 · severe (≥ 0.5 m)"}]},
               "about": "WRI Aqueduct riverine inundation, 25-yr return period. Smaller footprint than the 100-yr event."})

# 4. Exposed population 100-yr
d, bnds = reproject_to_4326(os.path.join(OUT, "flooded_population_belize_100m.tif"))
vmax2 = np.nanpercentile(d[d > 0], 97) if np.isfinite(d).any() else 1
to_rgba_png(d, purples, PowerNorm(0.5, vmin=0, vmax=vmax2), os.path.join(OVER, "exposed_pop.png"),
            mask_extra=lambda a: a > 0)
layers.append({"id": "exposed_pop", "name": "Exposed population — 1:100-yr",
               "file": "data/overlays/exposed_pop.png", "bounds": bnds, "group": "exposure",
               "legend": {"type": "gradient", "colors": ["#efedf5", "#3f007d"],
                          "labels": ["low", f"≥{vmax2:.0f} ppl / cell"]},
               "about": "Population living inside the 100-yr flood footprint. ~49,200 people exposed."})

# 5. EWS coverage gap 100-yr
d, bnds = reproject_to_4326(os.path.join(OUT, "ews_gap_100yr.tif"))
to_rgba_png(d, gapcmap, Normalize(1, 2), os.path.join(OVER, "ews_gap.png"),
            mask_extra=lambda a: a >= 1)
layers.append({"id": "ews_gap", "name": "Early-warning coverage gap",
               "file": "data/overlays/ews_gap.png", "bounds": bnds, "group": "exposure",
               "legend": {"type": "categorical",
                          "items": [{"color": "#f768a1", "label": "Gap at 25-yr baseline"},
                                    {"color": "#7a0177", "label": "Gap added by 100-yr expansion"}]},
               "about": "People flooded but outside modelled early-warning coverage."})

# ---- vectors to WGS84 ----
b = gpd.read_file(os.path.join(DATA, "Exercise_01", "BLZ_Admin01.geojson")).to_crs(4326)
b[["geometry"]].to_file(os.path.join(DDIR, "belize_boundary.geojson"), driver="GeoJSON")
t = gpd.read_file(os.path.join(DATA, "OSM", "OSM-towers2.geojson")).to_crs(4326)
t[["geometry"]].to_file(os.path.join(DDIR, "towers.geojson"), driver="GeoJSON")

# centre for initial view
cx = (layers[0]["bounds"][0][1] + layers[0]["bounds"][1][1]) / 2
cy = (layers[0]["bounds"][0][0] + layers[0]["bounds"][1][0]) / 2
meta = {"center": [cy, cx], "bounds": layers[0]["bounds"], "n_towers": int(len(t)), "layers": layers}
with open(os.path.join(DDIR, "layers.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=2)
print("Wrote", len(layers), "overlays + 2 vectors + layers.json")
print("Towers:", len(t))
