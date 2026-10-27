# Belize Flood Risk Explorer

An interactive web map of riverine flood hazard, exposed population, and
early-warning coverage gaps in Belize. Built from the outputs of the Belize
training notebooks (`Exercise_1_Common_Baseline_Workflow` and
`Exercise_2_Track_1_Hazard_Sensitivity`).

## Layers

| Group | Layer | Encoding |
|-------|-------|----------|
| Flood hazard | 1:100-yr & 1:25-yr tiers | ordinal orange → red (nuisance → severe) |
| Exposure & EWS | Exposed population (1:100-yr) | sequential purple |
| Exposure & EWS | Early-warning coverage gap | magenta alert |
| Context | Population (WorldPop 2025) | sequential blue |
| Context | Telecom masts, national boundary | points / outline |

Source: WRI Aqueduct riverine floods, WorldPop 2025, OpenStreetMap. Basemap © CARTO 


(Requires `rasterio`, `geopandas`, `matplotlib`, `numpy`.)
