/**
 * Cluster LOD hierarchy JSON schema (contract for generators and views).
 * See tools/clodexport/schema.md.
 */

export interface Bounds {
  center: [number, number, number];
  radius: number;
  error: number | null;
}

export interface Group {
  depth: number;
  bounds: Bounds;
}

export interface Cluster {
  groupId: number;
  refined: number;
  bounds: Bounds;
  indexCount: number;
  vertexCount: number;
  indices?: number[];
  boundaryInner?: number;
  boundaryOuter?: number;
}

export interface MeshData {
  vertices: [number, number, number][];
  indices: number[];
}

export interface HierarchyJson {
  mesh?: MeshData;
  groups: Group[];
  clusters: Cluster[];
}

export type ViewId = 'dag' | 'treemap' | 'comparison';
