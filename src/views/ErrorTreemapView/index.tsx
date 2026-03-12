import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { HierarchyJson, Cluster, Group } from '../../types';

const MIN_RECT_FOR_LABEL = 36; // min width/height to show cluster id
const TREEMAP_HEIGHT = 500;
const LEGEND_HEIGHT = 28;

interface TreemapNode {
  name: string;
  value: number;
  children?: TreemapNode[];
  cluster?: Cluster;
  group?: Group;
  groupId?: number;
  clusterIndex?: number;
}

interface ErrorTreemapViewProps {
  hierarchy: HierarchyJson;
}

function clusterError(c: Cluster): number {
  const e = c.bounds.error;
  if (e == null || e >= 1e30 || Number.isFinite(e) === false) return 0;
  return Math.max(0, e);
}

function buildTreemap(
  container: HTMLDivElement,
  svgEl: SVGSVGElement,
  hierarchy: HierarchyJson
): { minErr: number; maxErr: number } | null {
  const groups = hierarchy.groups;
  const clusters = hierarchy.clusters;
  if (!groups.length || !clusters.length) return null;

  const groupChildren: TreemapNode[][] = groups.map(() => []);
  clusters.forEach((c, i) => {
    const err = clusterError(c);
    groupChildren[c.groupId].push({
      name: `C${i}`,
      value: err + 1e-9,
      cluster: c,
      clusterIndex: i,
      groupId: c.groupId,
    });
  });

  const children: TreemapNode[] = groupChildren.map((clustersInGroup, gid) => {
    const value = clustersInGroup.reduce((s, n) => s + n.value, 0);
    return {
      name: `G${gid}`,
      value: value + 1e-9,
      children: clustersInGroup,
      group: groups[gid],
      groupId: gid,
    };
  });

  const root: TreemapNode = {
    name: 'root',
    value: children.reduce((s, n) => s + n.value, 0) + 1e-9,
    children,
  };

  const hierarchyRoot = d3.hierarchy(root, (d) => d.children)
    .sum((d) => d.value)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const width = container.clientWidth || 800;
  const height = TREEMAP_HEIGHT;

  const treemap = d3.treemap<TreemapNode>()
    .size([width, height])
    .padding(2)
    .round(true);

  const rootRect = treemap(hierarchyRoot);
  type LeafNode = d3.HierarchyRectangularNode<TreemapNode>;

  const leaves = rootRect.leaves() as LeafNode[];
  const errs = leaves
    .map((n) => (n.data.cluster ? clusterError(n.data.cluster) : 0))
    .filter((e) => e > 0);
  const minErr = errs.length ? (d3.min(errs) ?? 0) : 0;
  const maxErr = errs.length ? (d3.max(errs) ?? 1) : 0;
  const colorScale = (err: number) => {
    const t = maxErr > minErr ? (err - minErr) / (maxErr - minErr) : 0;
    return d3.interpolateYlOrRd(Math.max(0, Math.min(1, t)));
  };

  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  svg.attr('width', width).attr('height', height + LEGEND_HEIGHT);

  const cell = svg
    .append('g')
    .attr('class', 'treemap-cells')
    .selectAll('g')
    .data(leaves)
    .join('g')
    .attr('transform', (d) => `translate(${d.x0},${d.y0})`);

  cell
    .append('rect')
    .attr('width', (d) => d.x1 - d.x0)
    .attr('height', (d) => d.y1 - d.y0)
    .attr('fill', (d) => colorScale(d.data.cluster ? clusterError(d.data.cluster) : 0))
    .attr('stroke', '#333')
    .attr('stroke-width', 0.5)
    .attr('cursor', 'pointer');

  const text = cell
    .append('text')
    .attr('x', 4)
    .attr('y', 14)
    .attr('dy', 0)
    .attr('fill', '#fff')
    .attr('font-size', 10)
    .attr('pointer-events', 'none')
    .attr('overflow', 'hidden');
  text
    .text((d) => {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < MIN_RECT_FOR_LABEL || h < MIN_RECT_FOR_LABEL) return '';
      return d.data.clusterIndex != null ? `C${d.data.clusterIndex}` : '';
    })
    .clone(true)
    .lower()
    .attr('fill', 'none')
    .attr('stroke', '#000')
    .attr('stroke-width', 2);

  cell.append('title').text((d) => {
    const c = d.data.cluster;
    const g = d.data.group;
    if (!c) return d.data.name;
    const err = clusterError(c);
    const depth = g != null ? g.depth : '';
    return [
      `Cluster ${d.data.clusterIndex}`,
      `Group ${d.data.groupId}`,
      depth !== '' ? `Depth ${depth}` : null,
      `Error ${err.toExponential(4)}`,
      `Triangles ${c.indexCount / 3}`,
      `Vertices ${c.vertexCount}`,
    ]
      .filter(Boolean)
      .join(' · ');
  });

  const legend = svg
    .append('g')
    .attr('class', 'treemap-legend')
    .attr('transform', `translate(0,${height + 4})`);
  const legendWidth = Math.min(200, width - 16);
  const nStops = 5;
  for (let i = 0; i < nStops; i++) {
    const t = i / (nStops - 1);
    const v = minErr + t * (maxErr - minErr);
    legend
      .append('rect')
      .attr('x', (legendWidth * i) / nStops)
      .attr('y', 0)
      .attr('width', legendWidth / nStops + 1)
      .attr('height', 14)
      .attr('fill', colorScale(v))
      .attr('stroke', '#555')
      .attr('stroke-width', 0.5);
  }
  legend
    .append('text')
    .attr('x', 0)
    .attr('y', 26)
    .attr('font-size', 10)
    .attr('fill', '#aaa')
    .text(`Error: ${minErr === maxErr ? minErr.toExponential(2) : `${minErr.toExponential(1)} – ${maxErr.toExponential(1)}`}`);

  return { minErr, maxErr };
}

export function ErrorTreemapView({ hierarchy }: ErrorTreemapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!containerRef.current || !svgRef.current || !hierarchy.groups.length || !hierarchy.clusters.length) return;

    const run = () => {
      if (!containerRef.current || !svgRef.current) return;
      buildTreemap(containerRef.current, svgRef.current, hierarchy);
    };

    run();
    const ro = new ResizeObserver(run);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [hierarchy]);

  return (
    <div className="view-container" data-view="treemap">
      <h2>Error Treemap View</h2>
      <p className="view-description">
        Each rectangle is one cluster; size = geometric error (bounds.error). Color: yellow → red by error (bottlenecks stand out).
      </p>
      <div ref={containerRef} className="treemap-container" style={{ width: '100%', maxWidth: '100%' }}>
        <svg ref={svgRef} style={{ display: 'block' }} />
      </div>
    </div>
  );
}
