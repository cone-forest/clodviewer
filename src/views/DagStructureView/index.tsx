import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { HierarchyJson, Cluster } from '../../types';
import type { HierarchyStats } from '../../types/hierarchyStats';
import { BoundaryRatioHistogram } from '../../components/BoundaryRatioHistogram';
import { HierarchySummaryPanel } from '../../components/HierarchySummaryPanel';
import './DagStructureView.css';

/** Above this cluster count, show only groups by default; click a group to show its clusters. */
const GROUP_ONLY_THRESHOLD = 1500;

/** Link distance for cluster→group edges (compact). */
const LINK_DISTANCE_CLUSTER_GROUP = 60;
/** Link distance for group→group edges (more separation for readability). */
const LINK_DISTANCE_GROUP_GROUP = 140;

// Classic red→green color scale (shared by clusters and groups).
const CLUSTER_COLORS_WARM = ['#7F0000', '#C00000', '#FF8000', '#A0FF00', '#008000'];
const GROUP_COLORS_COOL = ['#7F0000', '#C00000', '#FF8000', '#A0FF00', '#008000'];

interface DagNode {
  id: string;
  type: 'group' | 'cluster';
  groupId?: number;
  clusterIndex?: number;
  depth: number; // group depth: lower at bottom, higher toward top
  x?: number;
  y?: number;
  fx?: number | null; // fixed position (set by d3-drag, cleared on release)
  fy?: number | null;
  boundaryRatio?: number; // inner/outer; higher = better (green)
}

interface DagLink {
  source: string | DagNode;
  target: string | DagNode;
  linkType: 'cluster-group' | 'group-group';
}

interface DagStructureViewProps {
  hierarchy: HierarchyJson;
  stats: HierarchyStats | null;
}

function getBoundaryRatio(c: Cluster): number {
  const inner = c.boundaryInner ?? 0;
  const outer = c.boundaryOuter ?? 0;
  if (outer > 0) return inner / outer;
  if (inner > 0) return Infinity; // no outer boundary = fully surrounded by neighbors (best)
  return 0;
}

/** All distinct parent group ids for group G (refined values of clusters in G with refined >= 0). */
function getGroupParentGroupIds(groupId: number, clusters: Cluster[]): number[] {
  const parentIds = new Set<number>();
  for (const c of clusters) {
    if (c.groupId === groupId && c.refined >= 0) parentIds.add(c.refined);
  }
  return [...parentIds];
}

export function DagStructureView({ hierarchy, stats }: DagStructureViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const setSelectedGroupIdRef = useRef(setSelectedGroupId);
  setSelectedGroupIdRef.current = setSelectedGroupId;
  const [highlightRange, setHighlightRange] = useState<{
    min: number;
    max: number;
    groupId?: number;
  } | null>(null);
  const [groupHighlightRange] = useState<{
    min: number;
    max: number;
  } | null>(null);
  const previousGroupPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const isDraggingRef = useRef(false);

  // Only re-run layout when selection changes in group-only mode (when visible nodes/links actually change).
  const expandedGroupForLayout =
    hierarchy.clusters.length > GROUP_ONLY_THRESHOLD ? selectedGroupId : null;

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(() => {
      setDimensions({
        width: el.clientWidth || 800,
        height: Math.max(400, el.clientHeight || 500),
      });
    });
    observer.observe(el);
    setDimensions({
      width: el.clientWidth || 800,
      height: Math.max(400, el.clientHeight || 500),
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current || !svgRef.current || !hierarchy.groups.length || !hierarchy.clusters.length) return;

    const groups = hierarchy.groups;
    const clusters = hierarchy.clusters;
    const { width, height } = dimensions;

    // Reuse group positions when expanding in group-only mode (read before clearing SVG).
    const prevPositions = new Map<number, { x: number; y: number }>();
    const svgEl = svgRef.current;
    if (svgEl) {
      d3.select(svgEl)
        .selectAll<SVGRectElement, DagNode>('.nodes.groups rect')
        .each(function (this: SVGRectElement) {
          const d = d3.select<SVGRectElement, DagNode>(this).datum();
          if (d?.type === 'group' && d.groupId != null) {
            const x = parseFloat(this.getAttribute('x') ?? '0') + 6;
            const y = parseFloat(this.getAttribute('y') ?? '0') + 6;
            prevPositions.set(d.groupId, { x, y });
          }
        });
    }
    previousGroupPositionsRef.current = prevPositions;

    const maxDepth = groups.length ? Math.max(...groups.map((g) => g.depth)) : 0;
    const padding = 60;
    const ySpan = height - 2 * padding;
    // y increases downward: depth 0 at bottom, maxDepth at top
    const depthToY = (depth: number) =>
      padding + (maxDepth - depth) * (maxDepth > 0 ? ySpan / maxDepth : 0);

    // Aggregate boundary inner/outer per group so we can show sum(inner)/sum(outer) on group nodes.
    const groupInnerSum = new Array(groups.length).fill(0);
    const groupOuterSum = new Array(groups.length).fill(0);
    clusters.forEach((c) => {
      if (c.groupId >= 0 && c.groupId < groups.length) {
        groupInnerSum[c.groupId] += c.boundaryInner ?? 0;
        groupOuterSum[c.groupId] += c.boundaryOuter ?? 0;
      }
    });

    const groupOnlyMode = clusters.length > GROUP_ONLY_THRESHOLD;
    const showClustersForGroup =
      !groupOnlyMode || (expandedGroupForLayout != null && expandedGroupForLayout >= 0 && expandedGroupForLayout < groups.length);
    const visibleClusterIndices =
      !showClustersForGroup
        ? []
        : groupOnlyMode && expandedGroupForLayout != null
          ? clusters
              .map((c, i) => (c.groupId === expandedGroupForLayout ? i : -1))
              .filter((i) => i >= 0)
          : clusters.map((_, i) => i);

    const nodes: DagNode[] = [];
    groups.forEach((_, i) => {
      const inner = groupInnerSum[i];
      const outer = groupOuterSum[i];
      let ratio = 0;
      if (outer > 0) ratio = inner / outer;
      else if (inner > 0) ratio = Infinity;
      nodes.push({
        id: `g${i}`,
        type: 'group',
        groupId: i,
        depth: groups[i].depth,
        boundaryRatio: ratio,
      });
    });
    visibleClusterIndices.forEach((i) => {
      const c = clusters[i];
      const ratio = getBoundaryRatio(c);
      nodes.push({
        id: `c${i}`,
        type: 'cluster',
        groupId: c.groupId,
        clusterIndex: i,
        depth: groups[c.groupId].depth,
        boundaryRatio: ratio,
      });
    });

    const links: DagLink[] = [];
    // Group → parent group(s) first so group-only view has no dangling refs.
    const groupParentAdded = new Set<string>();
    groups.forEach((_, gId) => {
      const parentIds = getGroupParentGroupIds(gId, clusters);
      for (const parentId of parentIds) {
        if (parentId >= 0 && parentId < groups.length) {
          const key = `g${gId}-g${parentId}`;
          if (!groupParentAdded.has(key)) {
            groupParentAdded.add(key);
            links.push({ source: `g${gId}`, target: `g${parentId}`, linkType: 'group-group' });
          }
        }
      }
    });
    visibleClusterIndices.forEach((i) => {
      const c = clusters[i];
      if (c.groupId >= 0 && c.groupId < groups.length) {
        links.push({ source: `c${i}`, target: `g${c.groupId}`, linkType: 'cluster-group' });
      }
    });

    // Build separate color scales for clusters and groups so they are visually distinct.
    const clusterRatios = nodes
      .filter((n): n is DagNode & { boundaryRatio: number } => n.type === 'cluster' && n.boundaryRatio != null)
      .map((n) => n.boundaryRatio);
    const groupRatios = nodes
      .filter((n): n is DagNode & { boundaryRatio: number } => n.type === 'group' && n.boundaryRatio != null)
      .map((n) => n.boundaryRatio);

    const clusterFinite = clusterRatios.filter((r) => Number.isFinite(r));
    const groupFinite = groupRatios.filter((r) => Number.isFinite(r));

    const minCluster = clusterFinite.length ? Math.min(...clusterFinite) : 0;
    const maxCluster = clusterFinite.length ? Math.max(...clusterFinite) : 1;
    const domainMaxCluster = minCluster === maxCluster ? minCluster + 1 : maxCluster;
    const spanCluster = domainMaxCluster - minCluster || 1;

    const minGroup = groupFinite.length ? Math.min(...groupFinite) : 0;
    const maxGroup = groupFinite.length ? Math.max(...groupFinite) : 1;
    const domainMaxGroup = minGroup === maxGroup ? minGroup + 1 : maxGroup;
    const spanGroup = domainMaxGroup - minGroup || 1;

    const clusterDomain = CLUSTER_COLORS_WARM.map((_, i) =>
      minCluster + (spanCluster * i) / Math.max(1, CLUSTER_COLORS_WARM.length - 1)
    );
    const groupDomain = GROUP_COLORS_COOL.map((_, i) =>
      minGroup + (spanGroup * i) / Math.max(1, GROUP_COLORS_COOL.length - 1)
    );

    const clusterColorScale = d3
      .scaleLinear<string>()
      .domain(clusterDomain)
      .range(CLUSTER_COLORS_WARM)
      .clamp(true);

    const groupColorScale = d3
      .scaleLinear<string>()
      .domain(groupDomain)
      .range(GROUP_COLORS_COOL)
      .clamp(true);

    const ratioToClusterColor = (r: number) => {
      if (!clusterRatios.length) return CLUSTER_COLORS_WARM[0];
      if (r === Infinity) return CLUSTER_COLORS_WARM[CLUSTER_COLORS_WARM.length - 1];
      const value = Number.isFinite(r) ? r : minCluster;
      return clusterColorScale(value);
    };

    const ratioToGroupColor = (r: number) => {
      if (!groupRatios.length) return GROUP_COLORS_COOL[0];
      if (r === Infinity) return GROUP_COLORS_COOL[GROUP_COLORS_COOL.length - 1];
      const value = Number.isFinite(r) ? r : minGroup;
      return groupColorScale(value);
    };

    // Start with depth-ordered layout; reuse previous positions when expanding in group-only mode.
    const prevPos = previousGroupPositionsRef.current;
    nodes.forEach((n) => {
      const fallbackX = width / 2;
      const fallbackY = depthToY(n.depth);
      if (n.type === 'group' && n.groupId != null && prevPos.has(n.groupId)) {
        const p = prevPos.get(n.groupId)!;
        n.x = p.x;
        n.y = p.y;
      } else if (n.type === 'cluster' && n.groupId != null && prevPos.has(n.groupId)) {
        const p = prevPos.get(n.groupId)!;
        n.x = p.x;
        n.y = p.y;
      } else {
        n.x = fallbackX;
        n.y = fallbackY;
      }
    });

    const simulation = d3
      .forceSimulation<DagNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<DagNode, DagLink>(links)
          .id((d) => d.id)
          .distance((d) => (d.linkType === 'group-group' ? LINK_DISTANCE_GROUP_GROUP : LINK_DISTANCE_CLUSTER_GROUP))
      )
      .force('charge', d3.forceManyBody().strength(-120))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY((d: DagNode) => depthToY(d.depth)).strength(0.9))
      .force('collision', d3.forceCollide().radius(12));

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const g = svg.append('g');

    const link = g
      .append('g')
      .attr('class', 'links')
      .selectAll<SVGLineElement, DagLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', (d) => (d.linkType === 'group-group' ? '#6a6a8a' : '#555'))
      .attr('stroke-opacity', (d) => (d.linkType === 'group-group' ? 0.8 : 0.6))
      .attr('stroke-width', (d) => (d.linkType === 'group-group' ? 1.5 : 1));

    const groupNodes = nodes.filter((n) => n.type === 'group');
    const clusterNodes = nodes.filter((n) => n.type === 'cluster');

    const groupNode = g
      .append('g')
      .attr('class', 'nodes groups')
      .selectAll<SVGRectElement, DagNode>('rect')
      .data(groupNodes)
      .join('rect')
      .attr('width', 12)
      .attr('height', 12)
      .attr('fill', (d) => (d.boundaryRatio != null ? ratioToGroupColor(d.boundaryRatio) : GROUP_COLORS_COOL[0]))
      .attr('stroke', '#888')
      .attr('stroke-width', 1.2)
      .attr('cursor', 'pointer');

    groupNode.append('title').text((d) => {
      const depth = groups[d.groupId!].depth;
      const inner = groupInnerSum[d.groupId!] ?? 0;
      const outer = groupOuterSum[d.groupId!] ?? 0;
      const r = d.boundaryRatio ?? 0;
      const ratioLabel = r === Infinity ? '∞' : r.toFixed(4);
      return `Group ${d.groupId}\ndepth ${depth}\nBoundary ratio (sum inner / sum outer): ${ratioLabel}\nInner sum: ${inner.toFixed(2)}\nOuter sum: ${outer.toFixed(2)}`;
    });

    groupNode.on('click', (_event, d) => {
      if (isDraggingRef.current) return;
      const gId = d.groupId;
      if (gId == null) return;
      setSelectedGroupIdRef.current((prev) => (prev === gId ? null : gId));
    });

    const drag = d3
      .drag<SVGRectElement, DagNode>()
      .on('start', () => {
        isDraggingRef.current = true;
      })
      .on('drag', (event, d) => {
        d.x = event.x;
        d.y = event.y;
        d.fx = event.x;
        d.fy = event.y;
        const allNodes = simulation.nodes();
        for (const node of allNodes) {
          if (node.type === 'cluster' && node.groupId === d.groupId) {
            node.x! += event.dx;
            node.y! += event.dy;
            node.fx = node.x;
            node.fy = node.y;
          }
        }
        // Update DOM directly during drag (no simulation.tick()) to avoid lag and ensure clusters move.
        link
          .attr('x1', (l) => (l.source as DagNode).x!)
          .attr('y1', (l) => (l.source as DagNode).y!)
          .attr('x2', (l) => (l.target as DagNode).x!)
          .attr('y2', (l) => (l.target as DagNode).y!);
        groupNode.attr('x', (n) => n.x! - 6).attr('y', (n) => n.y! - 6);
        clusterNode.attr('cx', (n) => n.x!).attr('cy', (n) => n.y!);
      })
      .on('end', (_event, d) => {
        d.fx = null;
        d.fy = null;
        const allNodes = simulation.nodes();
        for (const node of allNodes) {
          if (node.type === 'cluster' && node.groupId === d.groupId) {
            node.fx = null;
            node.fy = null;
          }
        }
        simulation.alpha(0.3);
        simulation.restart();
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 0);
      });
    groupNode.call(drag);

    const clusterNode = g
      .append('g')
      .attr('class', 'nodes clusters')
      .selectAll<SVGCircleElement, DagNode>('circle')
      .data(clusterNodes)
      .join('circle')
      .attr('r', 5)
      .attr('fill', (d) => (d.boundaryRatio != null ? ratioToClusterColor(d.boundaryRatio) : CLUSTER_COLORS_WARM[0]))
      .attr('stroke', '#333')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer');

    clusterNode.append('title').text((d) => {
      const r = d.boundaryRatio ?? 0;
      const c = clusters[d.clusterIndex!];
      const inner = c.boundaryInner ?? 0;
      const outer = c.boundaryOuter ?? 0;
      const depth = groups[c.groupId].depth;
      const ratioLabel = r === Infinity ? '∞' : r.toFixed(4);
      return `Cluster ${d.clusterIndex}\nGroup ${c.groupId}, depth ${depth}\nBoundary ratio: ${ratioLabel}\nInner: ${inner.toFixed(2)}\nOuter: ${outer.toFixed(2)}`;
    });

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as DagNode).x!)
        .attr('y1', (d) => (d.source as DagNode).y!)
        .attr('x2', (d) => (d.target as DagNode).x!)
        .attr('y2', (d) => (d.target as DagNode).y!);
      groupNode.attr('x', (d) => d.x! - 6).attr('y', (d) => d.y! - 6);
      clusterNode.attr('cx', (d) => d.x!).attr('cy', (d) => d.y!);
    });

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(
      zoom as unknown as (selection: d3.Selection<SVGSVGElement, unknown, null, undefined>) => void
    );

    return () => {
      simulation.stop();
    };
  }, [hierarchy, dimensions, expandedGroupForLayout]);

  // Highlight selected group node, its cluster nodes and edges, and bar-selected clusters when selection changes
  useEffect(() => {
    if (!svgRef.current || !hierarchy.groups.length) return;
    const clusters = hierarchy.clusters;
    const groupRatios = hierarchy.groups.map((_, gId) => {
      const groupClusters = clusters.filter((c) => c.groupId === gId);
      if (!groupClusters.length) return 0;
      let innerSum = 0;
      let outerSum = 0;
      for (const c of groupClusters) {
        innerSum += c.boundaryInner ?? 0;
        outerSum += c.boundaryOuter ?? 0;
      }
      if (outerSum > 0) return innerSum / outerSum;
      if (innerSum > 0) return Infinity;
      return 0;
    });
    const clusterCircles = d3
      .select(svgRef.current)
      .selectAll<SVGCircleElement, DagNode>('.nodes.clusters circle');
    const groupRects = d3
      .select(svgRef.current)
      .selectAll<SVGRectElement, DagNode>('.nodes.groups rect');
    const inHighlightRange = (d: DagNode): boolean => {
      if (!highlightRange || d.type !== 'cluster' || d.clusterIndex == null) return false;
      if (highlightRange.groupId != null && d.groupId !== highlightRange.groupId) return false;
      const ratio = getBoundaryRatio(clusters[d.clusterIndex]);
      if (!Number.isFinite(ratio)) return highlightRange.max === Infinity && ratio === Infinity;
      return ratio >= highlightRange.min && (highlightRange.max === Infinity || ratio <= highlightRange.max);
    };
    const inSelectedGroup = (d: DagNode): boolean =>
      selectedGroupId != null && d.type === 'cluster' && d.groupId === selectedGroupId;

    const inGroupHighlightRange = (groupId: number | undefined): boolean => {
      if (!groupHighlightRange || groupId == null) return false;
      const ratio = groupRatios[groupId];
      if (!Number.isFinite(ratio)) return groupHighlightRange.max === Infinity && ratio === Infinity;
      return (
        ratio >= groupHighlightRange.min &&
        (groupHighlightRange.max === Infinity || ratio <= groupHighlightRange.max)
      );
    };

    groupRects
      .attr('stroke', (d) => {
        if (d.groupId != null && inGroupHighlightRange(d.groupId)) return '#fc0';
        if (d.groupId === selectedGroupId) return '#f90';
        return '#888';
      })
      .attr('stroke-width', (d) => {
        if (d.groupId != null && inGroupHighlightRange(d.groupId)) return 2.5;
        if (d.groupId === selectedGroupId) return 2.5;
        return 1.2;
      })
      .attr('opacity', (d) => {
        if (!groupHighlightRange) return 1;
        return d.groupId != null && inGroupHighlightRange(d.groupId) ? 1 : 0.35;
      });

    clusterCircles
      .attr('stroke', (d) => {
        if (inSelectedGroup(d) || inHighlightRange(d)) return '#fc0';
        return '#333';
      })
      .attr('stroke-width', (d) => {
        if (inSelectedGroup(d) || inHighlightRange(d)) return 2.5;
        return 1;
      })
      .attr('opacity', (d) => {
        if (!highlightRange) return 1;
        return inHighlightRange(d) ? 1 : 0.35;
      });

    // Highlight edges from clusters in the selected group to that group
    const linkHighlight =
      selectedGroupId != null
        ? (d: DagLink) =>
            d.linkType === 'cluster-group' &&
            typeof d.source === 'object' &&
            (d.source as DagNode).groupId === selectedGroupId
        : () => false;
    d3.select(svgRef.current)
      .selectAll<SVGLineElement, DagLink>('.links line')
      .attr('stroke', (d) => (linkHighlight(d) ? '#e85' : d.linkType === 'group-group' ? '#6a6a8a' : '#555'))
      .attr('stroke-opacity', (d) => (linkHighlight(d) ? 1 : d.linkType === 'group-group' ? 0.8 : 0.6))
      .attr('stroke-width', (d) => (linkHighlight(d) ? 2.5 : d.linkType === 'group-group' ? 1.5 : 1));
  }, [hierarchy, selectedGroupId, highlightRange, groupHighlightRange]);

  return (
    <div className="view-container" data-view="dag">
      <h2>2D DAG View</h2>
      <p className="view-description">
        Nodes: clusters and groups colored by boundary ratio using a classic red→green scale.
        Edges: cluster → its group (groupId); group → group it was simplified from (refined).
        {hierarchy.clusters.length > GROUP_ONLY_THRESHOLD &&
          ' For large graphs only groups are shown; click a group to show its clusters.'}
      </p>
      <div className="dag-legend">
        <div className="dag-legend-row">
          <span className="dag-legend-label">Cluster boundary ratio (red → green):</span>
          <span className="dag-legend-bad">low / bad</span>
          <span
            className="dag-legend-bar"
            style={{
              background:
                'linear-gradient(to right, #7F0000, #C00000, #FF8000, #A0FF00, #008000)',
            }}
          />
          <span className="dag-legend-good">high / good</span>
        </div>
        <div className="dag-legend-row">
          <span className="dag-legend-label">Group boundary ratio (red → green):</span>
          <span className="dag-legend-bad">low / bad</span>
          <span
            className="dag-legend-bar"
            style={{
              background:
                'linear-gradient(to right, #7F0000, #C00000, #FF8000, #A0FF00, #008000)',
            }}
          />
          <span className="dag-legend-good">high / good</span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="dag-container"
        style={{ width: '100%', height: 'min(70vh, 560px)', minHeight: 400 }}
      >
        <svg ref={svgRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </div>

      {stats && (
        <div className="view-below">
          <HierarchySummaryPanel hierarchy={hierarchy} stats={stats} />
        </div>
      )}

      <div className="dag-stats">
        {selectedGroupId == null && (
          <p className="dag-stats-hint">
            Click a group node to see its boundary ratio distribution
            {hierarchy.clusters.length > GROUP_ONLY_THRESHOLD && ' and to show its clusters in the graph'}
            . Click a bar to highlight clusters in that range.
          </p>
        )}
        {selectedGroupId != null && selectedGroupId < hierarchy.groups.length && (
          <section className="dag-stats-section dag-stats-group">
            <h3 className="dag-stats-title">
              Group {selectedGroupId} (depth {hierarchy.groups[selectedGroupId].depth})
            </h3>
            <p className="dag-stats-meta">
              {hierarchy.clusters.filter((c) => c.groupId === selectedGroupId).length} clusters
            </p>
            <h4 className="dag-stats-subtitle">Boundary ratio distribution (this group)</h4>
            <BoundaryRatioHistogram
              ratios={hierarchy.clusters
                .filter((c) => c.groupId === selectedGroupId)
                .map(getBoundaryRatio)}
              groupId={selectedGroupId}
              onBarClick={(min, max) => {
                setHighlightRange((prev) =>
                  prev?.min === min && prev?.max === max && prev?.groupId === selectedGroupId
                    ? null
                    : { min, max, groupId: selectedGroupId }
                );
              }}
              highlightRange={highlightRange?.groupId === selectedGroupId ? highlightRange : null}
            />
          </section>
        )}
      </div>
    </div>
  );
}
