# View agent plans

This document describes the plan each agent should follow when implementing or improving one of the three Cluster LOD Viewer views. **Work on exactly one view**; do not modify the app shell, shared types, or other views.

---

## Shared context (all agents)

- **App shell** (`src/App.tsx`): Loads hierarchy JSON, stores generator label, and renders the active view. It passes props into your view component. Do not change the shell’s props interface for your view without coordinating.
- **Data contract**: Views consume `HierarchyJson` (and for Comparison, two of them). Types live in `src/types/hierarchy.ts`. Schema details: `tools/clodexport/schema.md`.
- **Tech**: React + TypeScript; D3 for graph/treemap; Three.js only where 3D/WebGL is needed. Styling: `src/App.css` and view-local styles as needed.
- **Placement**: Your view lives under `src/views/<ViewName>/`. Export the main component from `index.tsx`; the shell already imports it.

---

# Agent 1: DAG Structure View

## Goal

Implement or refine the **DAG Structure View** so users can spot **graph-structure issues**: e.g. DAG too shallow on one side, too linear (chain-like), or irregular branching. The view must make **boundary ratio** (internal vs external border) visible so bad clusters stand out.

## Scope

- **In scope**: Everything under `src/views/DagStructureView/` (and any view-specific assets/styles). Reading `HierarchyJson` and using `bounds`, `groups`, `clusters`, `boundaryInner`, `boundaryOuter`.
- **Out of scope**: App shell, other views, shared types (except consuming them), clodexport, or backend.

## Inputs your view receives

- **Props**: `{ hierarchy: HierarchyJson }`. The shell guarantees `hierarchy` is non-null when your view is mounted.
- **Relevant fields**:
  - `hierarchy.groups`: `{ depth, bounds }[]`; group id = array index.
  - `hierarchy.clusters`: `{ groupId, refined, bounds, indexCount, vertexCount, boundaryInner?, boundaryOuter?, indices? }[]`.
  - Boundary ratio for a cluster = `boundaryInner / (boundaryOuter || ε)`. High ratio = good (prefer green), low or &lt; 1 = bad (prefer red).

## Implementation plan

1. **Graph model**
   - **Nodes**: One node per cluster and **one node per group** (both required so that group–group parent/child is visible). Use a consistent id scheme (e.g. `c${index}` for clusters, `g${id}` for groups).
   - **Edges (two types)**:
     - **Cluster → group**: For each cluster with `refined >= 0`, add an edge from that cluster to the group with id `refined` (the group this cluster refines to).
     - **Group → parent group**: For each group G, derive its parent group: take any cluster C with `C.groupId === G`; then `parentGroupId = C.refined`. If `parentGroupId >= 0`, add an edge from group G to group `parentGroupId`. If `refined === -1`, group G is a root (no group parent). This gives the **parent/child relations between groups** (merge/split hierarchy): each group points to the more-detailed group it was created from.
   - Together these edges form the full DAG: groups are connected group→parent group, and clusters attach to groups via cluster→group.

2. **Layout**
   - Use a 2D layout (D3 force-directed, layered/Sugiyama, or other). Ensure the DAG direction (child → parent) is clear. Zoom and pan (e.g. D3 zoom) so large graphs are navigable.

3. **Boundary-ratio metric**
   - For each cluster node, compute (or use) `boundaryInner / (boundaryOuter || 1e-9)`.
   - **Color mapping**: Green = better (higher ratio), red = worse (lower ratio). Scale the metric (e.g. min–max across clusters) to a 0–1 scale and map to a green–red color scale so problematic clusters are immediately visible in red.

4. **Interaction and polish**
   - Tooltips: show cluster index, group id, depth, boundary ratio, and raw inner/outer lengths.
   - Optional: click to select/highlight a cluster or path; optional legend for the color scale.

5. **Performance**
   - For large hierarchies (many hundreds or thousands of nodes), use efficient rendering (e.g. one path for links, one for nodes; avoid per-node DOM explosion). Consider limiting visible nodes or level-of-detail if needed.

## Acceptance criteria

- [ ] Graph shows one node per cluster and one node per group.
- [ ] **Cluster → group** edges: each cluster with `refined >= 0` has an edge to the group `refined`.
- [ ] **Group → parent group** edges: each group G has an edge to its parent group (derived as `refined` of any cluster with `groupId === G`, when `refined >= 0`), so the merge/split hierarchy between groups is visible.
- [ ] Layout is 2D and readable (zoom/pan supported).
- [ ] Cluster nodes are colored by boundary ratio: green = higher ratio (good), red = lower ratio (bad).
- [ ] Tooltips show boundary ratio and related stats.
- [ ] No changes to App shell or other views; only `DagStructureView` and its assets are modified.

---

# Agent 2: Error Treemap View

## Goal

Implement or refine the **Error Treemap View** so it behaves like a **flame-graph** for the hierarchy: highlight **bottlenecks** and where geometric error (or cost) is concentrated. Each rectangle is one step in the hierarchy; **size** encodes a chosen error metric.

## Scope

- **In scope**: Everything under `src/views/ErrorTreemapView/`. Reading `HierarchyJson`: `groups`, `clusters`, and `bounds.error`.
- **Out of scope**: App shell, other views, shared types (except consuming them), clodexport, or backend.

## Inputs your view receives

- **Props**: `{ hierarchy: HierarchyJson }`. The shell guarantees `hierarchy` is non-null when your view is mounted.
- **Relevant fields**:
  - `hierarchy.groups`: `{ depth, bounds }[]`.
  - `hierarchy.clusters`: `{ groupId, refined, bounds, indexCount, vertexCount, indices? }[]`. Use `bounds.error` for geometric error (treat null/very large as terminal, e.g. 0 for sizing).

## Implementation plan

1. **Hierarchy for the treemap**
   - Build a tree D3 can lay out (e.g. `d3.hierarchy`): e.g. root → one child per group → each group’s clusters as children. Each **leaf** (cluster) has a **value** used for rectangle size.
   - **Size metric**: Use the geometric error the cluster introduces. A simple choice: `value = cluster.bounds.error` (or 0 if null/terminal). Alternative: error delta vs parent group’s error if you want “error introduced by this step.” Decide consistently and document in the UI (e.g. in the view description or tooltip).

2. **Layout**
   - Use `d3.treemap()` (or equivalent) to compute rectangles. Ensure the hierarchy is summed so parent size = sum of children (or your chosen aggregation).

3. **Visual encoding**
   - **Color**: Use a scale (e.g. yellow → orange → red) by the same error metric so high-error clusters stand out. Match the scale to the data (e.g. 0 to max error across leaves).
   - **Labels**: Show cluster (or group) id in each rectangle where space allows; avoid overlap (clip or hide when too small).

4. **Interaction**
   - Tooltips: cluster index, group id, depth, error value, and (if applicable) triangle/vertex counts.
   - Optional: click to drill down or highlight a branch; optional legend for color scale.

5. **Edge cases**
   - Terminal or missing `bounds.error`: treat as 0 (or a small epsilon) so the node still gets a tiny rectangle and remains visible.

## Acceptance criteria

- [ ] Treemap shows hierarchy (e.g. groups → clusters); each rectangle corresponds to one cluster (or one group, if you choose that design).
- [ ] Rectangle **size** is proportional to the chosen error metric (e.g. `bounds.error`).
- [ ] Color scale reflects error (e.g. yellow–red) so bottlenecks are obvious.
- [ ] Tooltips show error and key identifiers.
- [ ] No changes to App shell or other views; only `ErrorTreemapView` and its assets are modified.

---

# Agent 3: Generator Comparison View

## Goal

Implement or refine the **Generator Comparison View** so users can compare **two cluster hierarchies** (e.g. from two generators) on the **same mesh**. Show **side-by-side** images: **(lib1 − src)** on the left and **(lib2 − src)** on the right, from the **same camera**, with optional use of **runtime graph partitioning** (or similar) for efficiency.

## Scope

- **In scope**: Everything under `src/views/GeneratorComparisonView/`. Reading two `HierarchyJson` objects and their `mesh` (vertices, indices). Three.js (or WebGL) for rendering and diff.
- **Out of scope**: App shell’s way of loading two files and passing two hierarchies; other views; shared types (except consuming them); clodexport.

## Inputs your view receives

- **Props**: `{ hierarchy1: HierarchyJson; hierarchy2: HierarchyJson; generator1Label: string; generator2Label: string }`. The shell only mounts this view when both hierarchies are loaded.
- **Relevant fields**:
  - `hierarchy*.mesh`: `{ vertices: [x,y,z][], indices: number[] }`. Required for this view; if missing, show a clear message and do not run Three.js.
  - Use the same mesh (or a chosen “reference” mesh) as **src** for the diff. Typically ref = one of the two hierarchy meshes (e.g. first) so that “lib − src” compares each generator’s representation to that reference.

## Implementation plan

1. **Reference and two “lib” meshes**
   - **src (reference)**: e.g. `hierarchy1.mesh` or a canonical mesh both sides can use. Same geometry for both diffs so the comparison is fair.
   - **lib1**: Geometry (and optionally material) representing the first hierarchy (e.g. full mesh from `hierarchy1.mesh`, or an LOD cut if you implement it).
   - **lib2**: Same idea for the second hierarchy.
   - If either hierarchy has no `mesh`, show an error message and do not render (already supported in the shell; keep that behavior).

2. **Same camera**
   - Compute camera position and orientation from the **reference mesh** (e.g. bounding box center and distance). Use this **exact** camera for all three renders: ref, lib1, lib2. No per-panel camera drift.

3. **Rendering pipeline**
   - Render **ref** to a texture (render target).
   - Render **lib1** to a texture with the same camera and viewport size.
   - Render **lib2** to a texture with the same camera and viewport size.
   - **Left panel**: compute and display diff (lib1 − ref), e.g. pixel-wise absolute difference, visualized (e.g. red intensity).
   - **Right panel**: same for (lib2 − ref).

4. **Efficiency (runtime graph partitioning)**
   - If the hierarchy is large, consider rendering only **active** clusters (e.g. at a given error threshold) or partitioning the mesh by cluster so you only compare relevant patches. Document your strategy (e.g. “full mesh comparison” vs “LOD-cut comparison” vs “cluster-based patches”).

5. **UI**
   - Two panels side by side; labels = `generator1Label` and `generator2Label`. Optional: error threshold or LOD level control to switch what “lib” represents (e.g. which clusters are active). Optional: toggle to show raw lib render instead of diff.

## Acceptance criteria

- [ ] Left image = (lib1 − src), right image = (lib2 − src), both from the **same camera** (derived from the reference mesh).
- [ ] If either hierarchy has no `mesh`, show a clear message and do not run the 3D pipeline.
- [ ] Panels are labeled with the provided generator labels.
- [ ] No changes to App shell or other views; only `GeneratorComparisonView` and its assets are modified.
- [ ] Optional: document or implement a simple form of runtime graph partitioning (or LOD cut) for efficiency.

---

# Summary for agents

| View                   | Main tech   | Key output                         | Do not touch                    |
|------------------------|------------|-------------------------------------|---------------------------------|
| DAG Structure View     | D3 (graph) | 2D DAG, boundary ratio green–red    | Shell, other views, types        |
| Error Treemap View    | D3 (treemap) | Treemap, size = error, color scale  | Shell, other views, types       |
| Generator Comparison  | Three.js   | Two diff images, same camera        | Shell, other views, types       |

Each agent should implement or improve only their view, use the existing props and types, and leave the rest of the app unchanged.
