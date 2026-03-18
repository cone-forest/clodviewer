import type { HierarchyJson } from './hierarchy';

export interface PerLevelStats {
  depth: number;
  clusterCount: number;
  triangleCount: number;
  /**
   * Meshlet occupancy distribution for this depth:
   * key = triangles per cluster, value = number of clusters with that triangle count.
   */
  occupancyDistribution: Record<number, number>;
  /**
   * Vertex occupancy: key = vertexCount per cluster, value = number of clusters.
   */
  vertexOccupancyDistribution: Record<number, number>;
}

export interface LodProgressionPoint {
  depth: number;
  clusterCount: number;
  triangleCount: number;
  /**
   * Cluster count at this depth divided by the cluster count at the initial (finest) depth.
   * 1.0 for the initial depth, smaller for coarser levels.
   */
  ratioToInitial: number;
  /**
   * Triangle sum at this depth divided by triangle sum at the initial (finest) depth.
   */
  triangleRatioToInitial: number;
}

export interface BoundaryRatioSummary {
  /** Raw boundary ratio values for all clusters (one per cluster). */
  allClusterRatios: number[];
  /**
   * Raw boundary ratio values for all groups (one per group),
   * based on sum(boundaryInner)/sum(boundaryOuter) over the group's clusters.
   */
  allGroupRatios: number[];
}

export interface HierarchyStats {
  /** Per-depth statistics derived from group depths. */
  levels: PerLevelStats[];
  /** LOD progression curve based on cluster counts per depth. */
  lodProgression: LodProgressionPoint[];
  /** Total number of clusters across all depths. */
  totalClusters: number;
  /** Total triangle count across all depths (sum of indexCount/3). */
  totalTriangles: number;
  /** Maximum depth value found in groups (or 0 if none). */
  maxDepth: number;
  /** Boundary ratio summaries for clusters and groups. */
  boundaryRatios: BoundaryRatioSummary;
}

export function hasHierarchyData(h: HierarchyJson | null | undefined): h is HierarchyJson {
  return !!h && Array.isArray(h.groups) && Array.isArray(h.clusters) && (h.groups.length > 0 || h.clusters.length > 0);
}

