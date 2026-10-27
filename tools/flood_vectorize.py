import os, json, numpy as np, rasterio
from rasterio.features import shapes
import geopandas as gpd
from shapely.geometry import shape
from shapely.ops import unary_union

OUT  = r"C:\Users\afigueroa\Desktop\Training\Training\Code\output"
DDIR = r"C:\Users\afigueroa\Desktop\Training\Training\Code\belize-flood-webmap\data"

src_path = os.path.join(OUT, "wri_flood_belize_utm16n_100m.tif")
# depth class breaks (metres). Class 1 = shallow .. 4 = deepest.
BREAKS = [0.15, 0.25, 0.35, 0.50, 1e9]

with rasterio.open(src_path) as ds:
    a = ds.read(1).astype("float32")
    nod = ds.nodata
    valid = np.isfinite(a)
    if nod is not None:
        valid &= (a != nod)
    valid &= (a >= BREAKS[0])
    cls = np.zeros(a.shape, dtype="int32")
    for i in range(4):
        cls[valid & (a >= BREAKS[i]) & (a < BREAKS[i+1])] = i + 1
    transform = ds.transform
    crs = ds.crs

feats = []
for geom, val in shapes(cls, mask=(cls > 0), transform=transform):
    feats.append((shape(geom), int(val)))
print("raw polygons:", len(feats))

gdf = gpd.GeoDataFrame({"cls": [c for _, c in feats]},
                       geometry=[g for g, _ in feats], crs=crs)
# dissolve per class, drop slivers, simplify (metres, UTM)
gdf = gdf.dissolve(by="cls").reset_index()
gdf["geometry"] = gdf.geometry.simplify(40)
gdf = gdf[gdf.geometry.area > 20000]          # drop < ~2 cells
gdf = gdf.to_crs(4326)

out = os.path.join(DDIR, "flood_vectors.geojson")
gdf[["cls", "geometry"]].to_file(out, driver="GeoJSON")
sz = os.path.getsize(out)
print(f"wrote {out}  ({sz/1024:.0f} KB), classes: {sorted(gdf.cls.tolist())}")
