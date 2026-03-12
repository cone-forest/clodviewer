# Cluster LOD Viewer

Profiling-style visualization tool for cluster LOD hierarchies. Use it to inspect hierarchy structure, error distribution, and to compare two generators.

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Then open the URL shown (e.g. http://localhost:5173). Load a hierarchy JSON file produced by `clodexport`.

## Views

- **DAG Structure View** — 2D graph of clusters and groups; nodes colored by boundary ratio (green = good, red = bad). Zoom with scroll, drag to pan.
- **Error Treemap View** — Flame-graph style treemap; rectangle size = geometric error.
- **Generator Comparison View** — Load two hierarchy JSONs; side-by-side diff (lib − src) from the same camera. Both files must include `mesh` (vertices and indices).
