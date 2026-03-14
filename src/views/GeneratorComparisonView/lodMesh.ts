import type { HierarchyJson, MeshData } from '../../types';

/**
 * Builds a LOD mesh by including only triangles from clusters whose geometric error
 * is <= maxError. Uses the hierarchy's full mesh vertices; indices are the union
 * of indices from qualifying clusters. Clusters without `indices` are skipped.
 */
export function buildLodMesh(hierarchy: HierarchyJson, maxError: number): MeshData | null {
  const mesh = hierarchy.mesh;
  if (!mesh?.vertices?.length || !mesh?.indices?.length) return null;

  const indices: number[] = [];
  for (const cluster of hierarchy.clusters) {
    const err = cluster.bounds?.error;
    if (err == null || err > maxError) continue;
    if (!cluster.indices?.length) continue;
    indices.push(...cluster.indices);
  }

  if (indices.length === 0) return null;

  return {
    vertices: mesh.vertices,
    indices,
  };
}

/** Returns the maximum non-null bounds.error across all clusters, or 0 if none. */
export function getMaxError(hierarchy: HierarchyJson): number {
  let max = 0;
  for (const cluster of hierarchy.clusters) {
    const err = cluster.bounds?.error;
    if (err != null && err > max) max = err;
  }
  return max;
}
