import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { HierarchyJson, Cluster } from '../../types';
import './DagStructureView.css';

const HISTOGRAM_BINS = 14;
const HISTOGRAM_HEIGHT = 72;

interface DagNode {
  id: string;
  type: 'group' | 'cluster';
  groupId?: number;
  clusterIndex?: number;
  depth: number; // group depth: lower at bottom, higher toward top
  x?: number;
  y?: number;
  boundaryRatio?: number; // inner/outer; higher = better (green)
}

interface DagLink {
  source: string | DagNode;
  target: string | DagNode;
  linkType: 'cluster-group' | 'group-group';
}

interface DagStructureViewProps {
  hierarchy: HierarchyJson;
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

/** Bin counts for boundary ratio values; returns { bins: [x0, x1][], counts: number[] }. Infinity counts go in the last bin. */
function histogramBins(ratios: number[], numBins: number = HISTOGRAM_BINS): { bins: [number, number][]; counts: number[] } {
  if (ratios.length === 0) return { bins: [], counts: [] };
  const finite = ratios.filter((r) => Number.isFinite(r));
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  const span = max - min || 1;
  const step = span / numBins;
  const bins: [number, number][] = [];
  const counts: number[] = [];
  for (let i = 0; i < numBins; i++) {
    const x0 = min + i * step;
    const x1 = i === numBins - 1 ? Infinity : min + (i + 1) * step;
    bins.push([x0, x1]);
    const inRange = (r: number) => (Number.isFinite(r) && (x1 === Infinity ? r >= x0 : r >= x0 && r < x1)) || (r === Infinity && i === numBins - 1);
    counts.push(ratios.filter(inRange).length);
  }
  return { bins, counts };
}

export function DagStructureView({ hierarchy }: DagStructureViewProps) {
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

    const maxDepth = groups.length ? Math.max(...groups.map((g) => g.depth)) : 0;
    const padding = 60;
    const ySpan = height - 2 * padding;
    // y increases downward: depth 0 at bottom, maxDepth at top
    const depthToY = (depth: number) =>
      padding + (maxDepth - depth) * (maxDepth > 0 ? ySpan / maxDepth : 0);

    const nodes: DagNode[] = [];
    groups.forEach((_, i) => {
      nodes.push({ id: `g${i}`, type: 'group', groupId: i, depth: groups[i].depth });
    });
    clusters.forEach((c, i) => {
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
    // Cluster → group: each cluster belongs to a group; draw edge from cluster to that group.
    clusters.forEach((c, i) => {
      if (c.groupId >= 0 && c.groupId < groups.length) {
        links.push({ source: `c${i}`, target: `g${c.groupId}`, linkType: 'cluster-group' });
      }
    });
    // Group → parent group(s): each group G points to every group its clusters refine from (refined = source of simplification).
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

    const ratioValues = nodes
      .filter((n): n is DagNode & { boundaryRatio: number } => n.boundaryRatio != null)
      .map((n) => n.boundaryRatio);
    const finiteRatios = ratioValues.filter((r) => Number.isFinite(r));
    const minR = finiteRatios.length ? Math.min(...finiteRatios) : 0;
    const maxR = finiteRatios.length ? Math.max(...finiteRatios) : 1;
    const domainMax = minR === maxR ? minR + 1 : maxR;
    const colorScale = d3
      .scaleLinear<string>()
      .domain([minR, domainMax])
      .range(['#c00', '#0a0'])
      .clamp(true);
    const ratioToColor = (r: number) =>
      r === Infinity ? '#0a0' : colorScale(Number.isFinite(r) ? r : minR);

    // Start with depth-ordered layout: low depth at bottom, high at top
    nodes.forEach((n) => {
      n.x = width / 2;
      n.y = depthToY(n.depth);
    });

    const simulation = d3
      .forceSimulation<DagNode>(nodes)
      .force('link', d3.forceLink<DagNode, DagLink>(links).id((d) => d.id).distance(60))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('x', d3.forceX(width / 2))
      .force('y', d3.forceY((d) => depthToY(d.depth)).strength(0.4))
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

    const node = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGCircleElement, DagNode>('circle')
      .data(nodes)
      .join('circle')
      .attr('r', (d) => (d.type === 'group' ? 6 : 5))
      .attr('fill', (d) => (d.boundaryRatio != null ? ratioToColor(d.boundaryRatio) : '#666'))
      .attr('stroke', (d) => (d.type === 'group' ? '#888' : '#333'))
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer');

    node.append('title').text((d) => {
      if (d.type === 'group') {
        const depth = groups[d.groupId!].depth;
        return `Group ${d.groupId}\ndepth ${depth}`;
      }
      const r = d.boundaryRatio ?? 0;
      const c = clusters[d.clusterIndex!];
      const inner = c.boundaryInner ?? 0;
      const outer = c.boundaryOuter ?? 0;
      const depth = groups[c.groupId].depth;
      const ratioLabel = r === Infinity ? '∞' : r.toFixed(4);
      return `Cluster ${d.clusterIndex}\nGroup ${c.groupId}, depth ${depth}\nBoundary ratio: ${ratioLabel}\nInner: ${inner.toFixed(2)}\nOuter: ${outer.toFixed(2)}`;
    });

    node.on('click', (_event, d) => {
      if (d.type === 'group' && d.groupId != null)
        setSelectedGroupIdRef.current((prev) => (prev === d.groupId ? null : d.groupId));
    });

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as DagNode).x!)
        .attr('y1', (d) => (d.source as DagNode).y!)
        .attr('x2', (d) => (d.target as DagNode).x!)
        .attr('y2', (d) => (d.target as DagNode).y!);
      node.attr('cx', (d) => d.x!).attr('cy', (d) => d.y!);
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
  }, [hierarchy, dimensions]);

  // Highlight selected group node and bar-selected clusters when selection changes
  useEffect(() => {
    if (!svgRef.current || !hierarchy.groups.length) return;
    const clusters = hierarchy.clusters;
    const circles = d3.select(svgRef.current).selectAll<SVGCircleElement, DagNode>('.nodes circle');
    const inHighlightRange = (d: DagNode): boolean => {
      if (!highlightRange || d.type !== 'cluster' || d.clusterIndex == null) return false;
      if (highlightRange.groupId != null && d.groupId !== highlightRange.groupId) return false;
      const ratio = getBoundaryRatio(clusters[d.clusterIndex]);
      if (!Number.isFinite(ratio)) return highlightRange.max === Infinity && ratio === Infinity;
      return ratio >= highlightRange.min && (highlightRange.max === Infinity || ratio <= highlightRange.max);
    };
    circles
      .attr('stroke', (d) => {
        if (d.type === 'group')
          return d.groupId === selectedGroupId ? '#f90' : '#888';
        return inHighlightRange(d) ? '#fc0' : '#333';
      })
      .attr('stroke-width', (d) => {
        if (d.type === 'group' && d.groupId === selectedGroupId) return 2.5;
        if (d.type === 'cluster' && inHighlightRange(d)) return 2.5;
        return 1;
      })
      .attr('opacity', (d) => {
        if (!highlightRange) return 1;
        if (d.type === 'group') return 1;
        return inHighlightRange(d) ? 1 : 0.35;
      });
  }, [hierarchy, selectedGroupId, highlightRange]);

  return (
    <div className="view-container" data-view="dag">
      <h2>DAG Structure View</h2>
      <p className="view-description">
        Nodes: clusters (colored by boundary ratio — green = better, red = worse) and groups (gray).
        Edges: cluster → its group (groupId); group → group it was simplified from (refined).
      </p>
      <div className="dag-legend">
        <span className="dag-legend-label">Boundary ratio (clusters):</span>
        <span className="dag-legend-bad">low / bad</span>
        <span
          className="dag-legend-bar"
          style={{
            background: 'linear-gradient(to right, #c00, #0a0)',
          }}
        />
        <span className="dag-legend-good">high / good</span>
      </div>
      <div
        ref={containerRef}
        className="dag-container"
        style={{ width: '100%', height: 'min(70vh, 560px)', minHeight: 400 }}
      >
        <svg ref={svgRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </div>

      <div className="dag-stats">
        <section className="dag-stats-section">
          <h3 className="dag-stats-title">Boundary ratio distribution (all clusters)</h3>
          <BoundaryRatioHistogram
            ratios={hierarchy.clusters.map(getBoundaryRatio)}
            onBarClick={(min, max) => {
              setHighlightRange((prev) =>
                prev?.min === min && prev?.max === max && prev?.groupId === undefined
                  ? null
                  : { min, max }
              );
            }}
            highlightRange={highlightRange?.groupId === undefined ? highlightRange : null}
          />
        </section>
        {selectedGroupId == null && (
          <p className="dag-stats-hint">Click a group node to see its boundary ratio distribution. Click a bar to highlight clusters in that range.</p>
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

function formatAxisValue(v: number): string {
  if (v === 0) return '0';
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0))
    return v.toExponential(1);
  if (Math.abs(v) < 1) return v.toFixed(2);
  return v.toFixed(1);
}

interface BoundaryRatioHistogramProps {
  ratios: number[];
  groupId?: number;
  onBarClick?: (min: number, max: number, groupId?: number) => void;
  highlightRange?: { min: number; max: number; groupId?: number } | null;
}

function BoundaryRatioHistogram({ ratios, groupId, onBarClick, highlightRange }: BoundaryRatioHistogramProps) {
  const { bins, counts } = histogramBins(ratios);
  const maxCount = Math.max(1, ...counts);
  const vbW = 100;
  const vbH = 60;
  const barW = bins.length > 0 ? vbW / bins.length : 0;
  const finiteRatios = ratios.filter((r) => Number.isFinite(r));
  const minR = finiteRatios.length ? Math.min(...finiteRatios) : 0;
  const maxR = finiteRatios.length ? Math.max(...finiteRatios) : 1;
  const axisTicks = 5;
  const axisValues = Array.from({ length: axisTicks }, (_, i) =>
    minR + (i / (axisTicks - 1)) * (maxR - minR)
  );
  const hasInf = ratios.some((r) => r === Infinity);
  const isBarSelected = (x0: number, x1: number) =>
    highlightRange != null &&
    highlightRange.min === x0 &&
    (x1 === Infinity ? highlightRange.max === Infinity : highlightRange.max === x1) &&
    (highlightRange.groupId === undefined || highlightRange.groupId === groupId);

  return (
    <div className="dag-histogram-wrap">
      <svg
        className="dag-histogram"
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="none"
      >
        {bins.map(([x0, x1], i) => {
          const selected = isBarSelected(x0, x1);
          return (
            <rect
              key={i}
              x={(i / bins.length) * vbW}
              y={vbH - (counts[i] / maxCount) * vbH}
              width={barW}
              height={(counts[i] / maxCount) * vbH}
              fill="currentColor"
              opacity={selected ? 1 : 0.7}
              className={onBarClick ? 'dag-histogram-bar-clickable' : ''}
              onClick={() => onBarClick?.(x0, x1, groupId)}
            >
              <title>
                {formatAxisValue(x0)} – {x1 === Infinity ? '∞' : formatAxisValue(x1)} · {counts[i]} cluster{counts[i] === 1 ? '' : 's'}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="dag-histogram-axis" aria-hidden="true">
        {axisValues.map((val, i) => (
          <span
            key={i}
            className="dag-histogram-tick"
            style={{ left: `${(i / (axisTicks - 1)) * 100}%`, transform: 'translateX(-50%)' }}
          >
            {hasInf && i === axisTicks - 1 ? '∞' : formatAxisValue(val)}
          </span>
        ))}
      </div>
    </div>
  );
}
