"""
Build a smooth 3D population surface mesh from the WorldPop raster for the web
map. Outputs data/pop_surface.json: a triangulated height field in METER_OFFSETS
(east/north metres from an origin lon/lat), with per-vertex normals and colours.
Empty (near-zero) areas are dropped so the surface reads as rolling hills over
the populated zones rather than a flat sheet over the whole country.
"""
import json, os, numpy as np, rasterio
from rasterio.warp import transform as warp_transform

OUT  = r"C:\Users\afigueroa\Desktop\Training\Training\Code\output"
DDIR = r"C:\Users\afigueroa\Desktop\Training\Training\Code\belize-flood-webmap\data"
RAS  = os.path.join(OUT, "worldpop_belize_utm16n_100m.tif")

BLOCK  = 10      # 100 m cells -> 1 km grid nodes
EXAG   = 6.5     # vertical exaggeration (matches the old column elevationScale)
THRESH = 2.0     # drop triangles whose corners are all below this (residents/cell)

# ramp matching PEAK_RAMP in app.js (teal -> green -> yellow -> white)
STOPS = ['#0a2a3a','#0e6b7a','#1aa3a3','#5fcf7a','#c3e84b','#fbe94e','#fff4c2','#ffffff']
def _hex(h): return [int(h[1:3],16), int(h[3:5],16), int(h[5:7],16)]
_RGB = np.array([_hex(s) for s in STOPS], dtype=float)
def ramp(t):
    t = np.clip(t, 0, 1) * (len(STOPS)-1)
    i = np.floor(t).astype(int); f = (t - i)[...,None]
    j = np.minimum(i+1, len(STOPS)-1)
    return (_RGB[i]*(1-f) + _RGB[j]*f)

# ---- read + aggregate raster to a coarse grid ----
with rasterio.open(RAS) as ds:
    a = ds.read(1, masked=True).filled(0).astype('float64'); a[a < 0] = 0
    H, W = a.shape
    nh, nw = (H//BLOCK)*BLOCK, (W//BLOCK)*BLOCK
    a = a[:nh, :nw]
    agg = a.reshape(nh//BLOCK, BLOCK, nw//BLOCK, BLOCK).sum(axis=(1,3))  # residents / 1km cell
    R, C = agg.shape
    rows = (np.arange(R)+0.5)*BLOCK
    cols = (np.arange(C)+0.5)*BLOCK
    cc, rr = np.meshgrid(cols, rows)
    xs, ys = rasterio.transform.xy(ds.transform, rr.ravel(), cc.ravel())
    lon, lat = warp_transform(ds.crs, "EPSG:4326", list(xs), list(ys))
lon = np.array(lon).reshape(R, C); lat = np.array(lat).reshape(R, C)

# ---- light 3x3 smoothing so the surface rolls rather than spikes ----
def box3(x):
    p = np.pad(x, 1, mode='edge')
    s = np.zeros_like(x)
    for dr in (0,1,2):
        for dc in (0,1,2):
            s += p[dr:dr+x.shape[0], dc:dc+x.shape[1]]
    return s/9.0
sm = box3(agg)

# ---- geometry: metre offsets from the SW-most origin ----
lon0, lat0 = float(lon.min()), float(lat.min())
mx = (lon - lon0) * 111320.0 * np.cos(np.radians(lat0))
my = (lat - lat0) * 110540.0
z  = sm * EXAG

# ---- per-node normals from the true surface tangents ----
dmx_dc, dmy_dc, dz_dc = np.gradient(mx,axis=1), np.gradient(my,axis=1), np.gradient(z,axis=1)
dmx_dr, dmy_dr, dz_dr = np.gradient(mx,axis=0), np.gradient(my,axis=0), np.gradient(z,axis=0)
tc = np.stack([dmx_dc, dmy_dc, dz_dc], -1)
tr = np.stack([dmx_dr, dmy_dr, dz_dr], -1)
nrm = np.cross(tc, tr)
nrm[nrm[...,2] < 0] *= -1
nrm /= (np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-9)

# ---- per-node colour from (smoothed) density ----
vmax = float(agg.max())
col = ramp((sm/vmax)**0.45).astype('uint8')     # R,C,3

# ---- triangulate, dropping empty quads, reindex used vertices ----
pos_full = np.stack([mx, my, z], -1).reshape(-1, 3)
nrm_full = nrm.reshape(-1, 3)
col_full = col.reshape(-1, 3)
idx = lambda r, c: r*C + c

tris = []
for r in range(R-1):
    for c in range(C-1):
        quad = max(agg[r,c], agg[r,c+1], agg[r+1,c], agg[r+1,c+1])
        if quad < THRESH:
            continue
        a0, b0, c0, d0 = idx(r,c), idx(r,c+1), idx(r+1,c), idx(r+1,c+1)
        tris.append((a0, c0, b0)); tris.append((b0, c0, d0))
tris = np.array(tris, dtype=np.int64)

used = np.unique(tris)
remap = -np.ones(R*C, dtype=np.int64); remap[used] = np.arange(len(used))
indices = remap[tris].ravel().astype('uint32')

# alpha fades with density so the low-density fringe dissolves into the basemap
# instead of showing hard 1 km squares; dense cores stay fully opaque
alpha_full = (40 + 215*np.clip((sm/vmax)**0.40, 0, 1)).astype('uint8').reshape(-1,1)

P = pos_full[used]; N = nrm_full[used]; CO = col_full[used]; AL = alpha_full[used]
colors = np.concatenate([CO, AL], axis=1)  # RGBA

out = {
    "origin": [round(lon0,6), round(lat0,6)],
    "grid":   [int(R), int(C)],
    "exag":   EXAG,
    "max":    vmax,
    "positions": [round(float(v),1) for v in P.ravel()],
    "normals":   [round(float(v),3) for v in N.ravel()],
    "colors":    [int(v) for v in colors.ravel()],
    "indices":   [int(v) for v in indices],
}
path = os.path.join(DDIR, "pop_surface.json")
json.dump(out, open(path, "w"))
kb = os.path.getsize(path)/1024
print(f"vertices {len(used):,}  triangles {len(tris):,}  -> {path}  ({kb:,.0f} KB)")
