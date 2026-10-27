import os, json, numpy as np, rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling, transform_bounds, transform as warp_transform
import geopandas as gpd
from shapely.ops import unary_union
import matplotlib.image as mpimg
from matplotlib.colors import LinearSegmentedColormap, PowerNorm

OUT  = r"C:\Users\afigueroa\Desktop\Training\Training\Code\output"
DATA = r"C:\Users\afigueroa\Desktop\Training\Training\Data"
SITE = r"C:\Users\afigueroa\Desktop\Training\Training\Code\belize-flood-webmap"
DDIR = os.path.join(SITE, "data")
OVER = os.path.join(DDIR, "overlays")
os.makedirs(OVER, exist_ok=True)

meta = {}

# ---------- 1 & 2: aggregate population rasters to coarse points (lng,lat,value) ----------
def aggregate_points(path, block=10, vmin=1.0):
    with rasterio.open(path) as ds:
        a = ds.read(1, masked=True).filled(0).astype("float64")
        a[a < 0] = 0
        H, W = a.shape
        nh, nw = (H // block) * block, (W // block) * block
        a = a[:nh, :nw]
        agg = a.reshape(nh // block, block, nw // block, block).sum(axis=(1, 3))
        rows = (np.arange(nh // block) + 0.5) * block
        cols = (np.arange(nw // block) + 0.5) * block
        cc, rr = np.meshgrid(cols, rows)
        xs, ys = rasterio.transform.xy(ds.transform, rr.ravel(), cc.ravel())
        lon, lat = warp_transform(ds.crs, "EPSG:4326", list(xs), list(ys))
    lon = np.array(lon); lat = np.array(lat); v = agg.ravel()
    keep = v >= vmin
    pts = [[round(float(lon[i]), 5), round(float(lat[i]), 5), round(float(v[i]), 1)]
           for i in np.nonzero(keep)[0]]
    return pts, float(v[keep].max()) if keep.any() else 0.0

pop_pts, pop_max = aggregate_points(os.path.join(OUT, "worldpop_belize_utm16n_100m.tif"))
exp_pts, exp_max = aggregate_points(os.path.join(OUT, "flooded_population_belize_100m.tif"))
json.dump(pop_pts, open(os.path.join(DDIR, "population_points.json"), "w"))
json.dump(exp_pts, open(os.path.join(DDIR, "exposed_points.json"), "w"))
meta["population"] = {"max": pop_max, "count": len(pop_pts), "cell_km": 1.0}
meta["exposed"]    = {"max": exp_max, "count": len(exp_pts), "cell_km": 1.0}
print(f"population points: {len(pop_pts)} (max {pop_max:.0f}/km²)")
print(f"exposed points   : {len(exp_pts)} (max {exp_max:.0f}/km²)")

# ---------- 3: flood depth -> fading reds raster (reprojected to 3857 for alignment) ----------
def red_overlay(path, out_png, pct=96):
    with rasterio.open(path) as src:
        dst = "EPSG:3857"
        tr, w, h = calculate_default_transform(src.crs, dst, src.width, src.height, *src.bounds)
        data = np.full((h, w), np.nan, dtype="float32")
        reproject(rasterio.band(src, 1), data, src_transform=src.transform, src_crs=src.crs,
                  dst_transform=tr, dst_crs=dst, resampling=Resampling.bilinear,
                  src_nodata=src.nodata, dst_nodata=np.nan)
        b = transform_bounds(dst, "EPSG:4326", *rasterio.transform.array_bounds(h, w, tr))
    valid = np.isfinite(data) & (data > 0.15)         # >=15 cm depth
    vmax = np.nanpercentile(data[valid], pct) if valid.any() else 1
    # fully red severity ramp: light red (shallow) -> dark crimson (severe)
    reds = LinearSegmentedColormap.from_list("sev", ["#fcbba1", "#fc8d59", "#e34a33", "#b30000", "#67000d"])
    rgba = np.zeros((data.shape[0], data.shape[1], 4), dtype="uint8")
    if valid.any():
        normed = PowerNorm(0.7, vmin=0.15, vmax=vmax)(np.ma.masked_array(data, ~valid))
        cols = reds(normed)
        rgba[..., :3] = (cols[..., :3] * 255).astype("uint8")
        rgba[..., 3] = np.where(valid, 235, 0).astype("uint8")
    mpimg.imsave(out_png, rgba)
    west, south, east, north = b
    return [west, south, east, north], float(vmax)

flood_bounds, flood_vmax = red_overlay(os.path.join(OUT, "wri_flood_belize_utm16n_100m.tif"),
                                       os.path.join(OVER, "flood_severity.png"), pct=88)
meta["flood"] = {"bounds": flood_bounds, "vmax": flood_vmax}
print(f"flood severity raster -> vmax {flood_vmax:.2f} m")

# ---------- 4: telecom masts 5 km buffers in EPSG:32616, dissolved ----------
masts = gpd.read_file(os.path.join(DATA, "OSM", "OSM-towers2.geojson")).to_crs(32616)
masts_4326 = masts.to_crs(4326)
coverage = gpd.GeoSeries([unary_union(masts.buffer(5000).values)], crs=32616).to_crs(4326)
gpd.GeoDataFrame(geometry=coverage).to_file(os.path.join(DDIR, "mast_coverage.geojson"), driver="GeoJSON")

# mast points as compact [lng,lat]
mpts = [[round(float(p.x), 5), round(float(p.y), 5)] for p in masts_4326.geometry]
json.dump(mpts, open(os.path.join(DDIR, "masts.json"), "w"))
meta["masts"] = {"count": len(mpts), "buffer_km": 5, "buffer_crs": "EPSG:32616"}
print(f"masts: {len(mpts)}, 5km coverage dissolved")

# ---------- overall bounds / center ----------
b = masts_4326.total_bounds
# use country bounds from population raster
with rasterio.open(os.path.join(OUT, "worldpop_belize_utm16n_100m.tif")) as ds:
    cb = transform_bounds(ds.crs, "EPSG:4326", *ds.bounds)
meta["bounds"] = [cb[0], cb[1], cb[2], cb[3]]
meta["center"] = [round((cb[0] + cb[2]) / 2, 4), round((cb[1] + cb[3]) / 2, 4)]
json.dump(meta, open(os.path.join(DDIR, "story_meta.json"), "w"), indent=2)
print("wrote story_meta.json; center", meta["center"])
