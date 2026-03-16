import type { Cluster, Group, HierarchyJson } from '../types';
import type {
  BoundaryRatioSummary,
  HierarchyStats,
  LodProgressionPoint,
  PerLevelStats,
} from '../types/hierarchyStats';

function trianglesForCluster(c: Cluster): number {
  return c.indexCount / 3;
}

function boundaryRatioForCluster(c: Cluster): number {
  const inner = c.boundaryInner ?? 0;
  const outer = c.boundaryOuter ?? 0;
  if (outer > 0) return inner / outer;
  if (inner > 0) return Infinity;
  return 0;
}

function computeGroupBoundaryRatios(groups: Group[], clusters: Cluster[]): number[] {
  if (!groups.length) return [];
  const innerSum = new Array<number>(groups.length).fill(0);
  const outerSum = new Array<number>(groups.length).fill(0);
  for (const c of clusters) {
    if (c.groupId >= 0 && c.groupId < groups.length) {
      innerSum[c.groupId] += c.boundaryInner ?? 0;
      outerSum[c.groupId] += c.boundaryOuter ?? 0;
    }
  }
  return groups.map((_, gid) => {
    const inner = innerSum[gid];
    const outer = outerSum[gid];
    if (outer > 0) return inner / outer;
    if (inner > 0) return Infinity;
    return 0;
  });
}

function computeBoundaryRatioSummary(hierarchy: HierarchyJson): BoundaryRatioSummary {
  const allClusterRatios = hierarchy.clusters.map(boundaryRatioForCluster);
  const allGroupRatios = computeGroupBoundaryRatios(hierarchy.groups, hierarchy.clusters);
  return { allClusterRatios, allGroupRatios };
}

function computePerLevelStats(hierarchy: HierarchyJson): {
  levels: PerLevelStats[];
  totalClusters: number;
  totalTriangles: number;
  maxDepth: number;
} {
  const { groups, clusters } = hierarchy;
  if (!groups.length || !clusters.length) {
    return { levels: [], totalClusters: 0, totalTriangles: 0, maxDepth: 0 };
  }

  const depthToClusters = new Map<number, Cluster[]>();
  const depthToGroups = new Map<number, Group[]>();

  groups.forEach((g, gid) => {
    const list = depthToGroups.get(g.depth);
    if (list) {
      list.push(g);
    } else {
      depthToGroups.set(g.depth, [g]);
    }
  });

  clusters.forEach((c) => {
    const group = groups[c.groupId];
    if (!group) return;
    const depth = group.depth;
    const list = depthToClusters.get(depth);
    if (list) {
      list.push(c);
    } else {
      depthToClusters.set(depth, [c]);
    }
  });

  const depths = Array.from(
    new Set<number>([...depthToClusters.keys(), ...depthToGroups.keys()]),
  ).sort((a, b) => a - b);

  let totalClusters = 0;
  let totalTriangles = 0;
  const levels: PerLevelStats[] = depths.map((depth) => {
    const levelClusters = depthToClusters.get(depth) ?? [];
    const clusterCount = levelClusters.length;
    let triangleCount = 0;
    const occupancyDistribution: Record<number, number> = Object.create(null);
    for (const c of levelClusters) {
      const tris = trianglesForCluster(c);
      triangleCount += tris;
      const key = tris | 0;
      occupancyDistribution[key] = (occupancyDistribution[key] ?? 0) + 1;
    }
    totalClusters += clusterCount;
    totalTriangles += triangleCount;
    return {
      depth,
      clusterCount,
      triangleCount,
      occupancyDistribution,
    };
  });

  const maxDepth = depths.length ? depths[depths.length - 1] : 0;

  return { levels, totalClusters, totalTriangles, maxDepth };
}

function computeLodProgression(levels: PerLevelStats[]): LodProgressionPoint[] {
  if (!levels.length) return [];
  const initialClusterCount = levels[0].clusterCount || 1;
  return levels.map((level) => {
    const ratioToInitial =
      initialClusterCount > 0 ? level.clusterCount / initialClusterCount : 0;
    return {
      depth: level.depth,
      clusterCount: level.clusterCount,
      ratioToInitial,
    };
  });
}

export function computeHierarchyStats(hierarchy: HierarchyJson): HierarchyStats {
  const { levels, totalClusters, totalTriangles, maxDepth } =
    computePerLevelStats(hierarchy);
  const lodProgression = computeLodProgression(levels);
  const boundaryRatios = computeBoundaryRatioSummary(hierarchy);

  return {
    levels,
    lodProgression,
    totalClusters,
    totalTriangles,
    maxDepth,
    boundaryRatios,
  };
}

